#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>

#include <node_api.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>

namespace {

enum class Direction { Back, Forward };

constexpr double kMinHorizontalPoints = 3.0;
constexpr double kHorizontalToVerticalRatio = 1.35;
constexpr double kMaxVerticalPoints = 18.0;
constexpr double kCompletionFallback = 0.995;
constexpr CFTimeInterval kLostGestureSeconds = 12.0;
// Magnification a pinch has to build up before JavaScript is asked whether to take it over.
constexpr double kPinchStartThreshold = 0.03;

napi_env g_env = nullptr;
napi_ref g_begin = nullptr;
napi_ref g_progress = nullptr;
napi_ref g_end = nullptr;
napi_ref g_resource = nullptr;
napi_async_context g_async = nullptr;
bool g_cleanupHook = false;
id g_scrollMonitor = nil;
id g_magnifyMonitor = nil;
napi_ref g_pinch = nullptr;
double g_pinchTotal = 0.0;
bool g_pinchAsked = false;
bool g_pinchTaken = false;

NSSize g_pendingDelta = NSZeroSize;
// When the current gesture's fingers went down (NSEvent timestamp): JavaScript's intent check
// (src/shared/swipe-intent.ts) reads the running totals and how long they took.
NSTimeInterval g_pendingBeganAt = 0.0;
bool g_pendingRefused = false;
bool g_tracking = false;
bool g_releaseReported = false;
int32_t g_generation = 0;
int32_t g_contentsId = 0;
Direction g_direction = Direction::Back;
double g_peakProgress = 0.0;
CFTimeInterval g_startedAt = 0.0;

const char* Name(Direction direction) {
  return direction == Direction::Back ? "back" : "forward";
}

bool HasPhase(NSEventPhase value, NSEventPhase flag) {
  return (value & flag) != 0;
}

bool Invoke(napi_ref callbackRef, size_t argc, napi_value* argv, napi_value* result) {
  if (!g_env || !callbackRef || !g_async || !g_resource) return false;

  napi_value callback = nullptr;
  napi_value resource = nullptr;
  if (napi_get_reference_value(g_env, callbackRef, &callback) != napi_ok || !callback ||
      napi_get_reference_value(g_env, g_resource, &resource) != napi_ok || !resource) {
    return false;
  }

  napi_callback_scope callbackScope = nullptr;
  if (napi_open_callback_scope(g_env, resource, g_async, &callbackScope) != napi_ok) return false;
  const bool called =
      napi_make_callback(g_env, g_async, resource, callback, argc, argv, result) == napi_ok;

  napi_value pendingError = nullptr;
  bool hasPendingError = false;
  napi_is_exception_pending(g_env, &hasPendingError);
  if (hasPendingError) napi_get_and_clear_last_exception(g_env, &pendingError);
  napi_close_callback_scope(g_env, callbackScope);
  if (pendingError) napi_fatal_exception(g_env, pendingError);

  return called;
}

napi_value Number(double value) {
  napi_value result = nullptr;
  napi_create_double(g_env, value, &result);
  return result;
}

void ReportProgress(double progress) {
  if (!g_env || !g_progress) return;
  napi_handle_scope scope = nullptr;
  if (napi_open_handle_scope(g_env, &scope) != napi_ok) return;

  napi_value args[2] = {nullptr, nullptr};
  napi_create_int32(g_env, g_contentsId, &args[0]);
  args[1] = Number(progress);
  Invoke(g_progress, 2, args, nullptr);
  napi_close_handle_scope(g_env, scope);
}

void ReportEnd(bool committed) {
  if (!g_env || !g_end) return;
  napi_handle_scope scope = nullptr;
  if (napi_open_handle_scope(g_env, &scope) != napi_ok) return;

  napi_value args[4] = {nullptr, nullptr, nullptr, nullptr};
  napi_create_int32(g_env, g_contentsId, &args[0]);
  napi_create_string_utf8(g_env, Name(g_direction), NAPI_AUTO_LENGTH, &args[1]);
  napi_get_boolean(g_env, committed, &args[2]);
  args[3] = Number(g_peakProgress);
  Invoke(g_end, 4, args, nullptr);
  napi_close_handle_scope(g_env, scope);
}

// JavaScript's answer to a begin request: start tracking, keep watching this gesture, or refuse it.
enum class BeginAnswer { Allow, Wait, Refuse };

BeginAnswer AskJavaScript(NSWindow* window, NSPoint point, Direction direction, NSSize delta, double elapsedMs, int32_t* contentsId) {
  if (!g_env || !g_begin || !window.contentView) return BeginAnswer::Refuse;

  napi_handle_scope scope = nullptr;
  if (napi_open_handle_scope(g_env, &scope) != napi_ok) return BeginAnswer::Refuse;

  napi_value request = nullptr;
  napi_create_object(g_env, &request);
  // Electron's getNativeWindowHandle() is the window's content NSView* on macOS, packed as the
  // raw pointer value. Copy the pointer itself (&handle), not the bytes of the object it points at.
  const void* nativeViewHandle = (__bridge const void*)window.contentView;
  void* copiedHandle = nullptr;
  napi_value handleBuffer = nullptr;
  napi_create_buffer_copy(g_env, sizeof(nativeViewHandle), &nativeViewHandle, &copiedHandle, &handleBuffer);
  napi_set_named_property(g_env, request, "windowHandle", handleBuffer);
  napi_set_named_property(g_env, request, "x", Number(point.x));
  napi_set_named_property(g_env, request, "y", Number(point.y));
  napi_value directionValue = nullptr;
  napi_create_string_utf8(g_env, Name(direction), NAPI_AUTO_LENGTH, &directionValue);
  napi_set_named_property(g_env, request, "direction", directionValue);
  napi_set_named_property(g_env, request, "dx", Number(delta.width));
  napi_set_named_property(g_env, request, "dy", Number(delta.height));
  napi_set_named_property(g_env, request, "elapsedMs", Number(elapsedMs));

  napi_value response = nullptr;
  const bool called = Invoke(g_begin, 1, &request, &response);
  BeginAnswer answer = BeginAnswer::Refuse;
  if (called && response) {
    napi_valuetype type = napi_undefined;
    napi_typeof(g_env, response, &type);
    if (type == napi_number) {
      int32_t value = 0;
      if (napi_get_value_int32(g_env, response, &value) == napi_ok) {
        if (value > 0) {
          answer = BeginAnswer::Allow;
          *contentsId = value;
        } else if (value == -1) {
          // MAC_SWIPE_KEEP_WATCHING: not enough intent yet (deadzone / too slow); ask again next event.
          answer = BeginAnswer::Wait;
        }
      }
    }
  }

  napi_close_handle_scope(g_env, scope);
  return answer;
}

void ClearTracking(bool reportCancellation) {
  if (reportCancellation && g_tracking && !g_releaseReported) ReportEnd(false);
  g_tracking = false;
  g_releaseReported = false;
  g_peakProgress = 0.0;
  g_contentsId = 0;
  ++g_generation;
}

bool MonitorScrollWheel(NSEvent* event) {
  const bool began = HasPhase(event.phase, NSEventPhaseBegan);

  if (g_tracking) {
    const bool timedOut = CACurrentMediaTime() - g_startedAt > kLostGestureSeconds;
    if (!began && !timedOut) {
      // Once AppKit owns the swipe, don't second-guess it. trackSwipeEventWithOptions was started
      // with NSEventSwipeTrackingLockDirection, so AppKit already ignores vertical drift. Re-running
      // the start-of-gesture drift check here cancelled the swipe as soon as the accumulated vertical
      // movement passed 18pt, which happens on most real swipes, so the page jumped back mid-gesture.
      return true;
    }
    ClearTracking(true);
    if (timedOut && !began) {
      g_pendingRefused = true;
      return false;
    }
  }

  if (began) {
    g_pendingDelta = NSZeroSize;
    g_pendingRefused = false;
    g_pendingBeganAt = event.timestamp;
    return false;
  }

  if (g_pendingRefused || !HasPhase(event.phase, NSEventPhaseChanged) ||
      event.momentumPhase != NSEventPhaseNone || !event.hasPreciseScrollingDeltas) {
    return false;
  }

  g_pendingDelta.width += event.scrollingDeltaX;
  g_pendingDelta.height += event.scrollingDeltaY;

  if (std::abs(g_pendingDelta.height) > kMaxVerticalPoints) {
    g_pendingRefused = true;
    return false;
  }

  const double horizontal = std::abs(g_pendingDelta.width);
  const double vertical = std::abs(g_pendingDelta.height);
  if (horizontal < kMinHorizontalPoints || horizontal <= vertical * kHorizontalToVerticalRatio) {
    return false;
  }

  NSWindow* window = event.window;
  NSView* contentView = window.contentView;
  if (!contentView) {
    g_pendingRefused = true;
    return false;
  }

  const Direction direction = g_pendingDelta.width > 0 ? Direction::Back : Direction::Forward;
  const NSPoint localPoint = [contentView convertPoint:event.locationInWindow fromView:nil];
  const CGFloat topOriginY = contentView.isFlipped
                                 ? localPoint.y
                                 : NSHeight(contentView.bounds) - localPoint.y;
  int32_t contentsId = 0;
  const double elapsedMs = g_pendingBeganAt > 0.0 ? std::max(0.0, (event.timestamp - g_pendingBeganAt) * 1000.0) : 0.0;
  const BeginAnswer answer = AskJavaScript(window, NSMakePoint(localPoint.x, topOriginY), direction, g_pendingDelta, elapsedMs, &contentsId);
  if (answer == BeginAnswer::Wait) return false;
  if (answer != BeginAnswer::Allow) {
    g_pendingRefused = true;
    return false;
  }

  g_tracking = true;
  g_releaseReported = false;
  g_contentsId = contentsId;
  g_direction = direction;
  g_peakProgress = 0.0;
  g_startedAt = CACurrentMediaTime();
  const int32_t generation = ++g_generation;

  [event trackSwipeEventWithOptions:NSEventSwipeTrackingLockDirection
          dampenAmountThresholdMin:-1.0
                               max:1.0
                      usingHandler:^(CGFloat amount, NSEventPhase phase, BOOL complete, BOOL* stop) {
                        if (!g_env || !g_tracking || generation != g_generation) {
                          *stop = YES;
                          return;
                        }

                        const double progress = std::clamp(std::abs(static_cast<double>(amount)), 0.0, 1.0);
                        g_peakProgress = std::max(g_peakProgress, progress);
                        if (!g_releaseReported) ReportProgress(progress);

                        const bool ended = HasPhase(phase, NSEventPhaseEnded);
                        const bool cancelled = HasPhase(phase, NSEventPhaseCancelled);
                        if ((ended || cancelled) && !g_releaseReported) {
                          g_releaseReported = true;
                          ReportEnd(ended);
                        }

                        if (!complete) return;
                        if (!g_releaseReported) {
                          g_releaseReported = true;
                          ReportEnd(progress >= kCompletionFallback);
                        }
                        g_tracking = false;
                        g_releaseReported = false;
                        g_pendingDelta = NSZeroSize;
                        g_pendingRefused = false;
                        g_contentsId = 0;
                        ++g_generation;
                      }];

  return true;
}

// Asks JavaScript whether a finished pinch ("in" or "out") should be taken over. A yes swallows
// the rest of that pinch so the page doesn't also zoom.
// Reports pinch phases to JavaScript: "begin" (return true to take the pinch over), then
// "change" / "end" / "cancel" for a pinch that was taken, each with the running magnification.
bool ReportPinch(const char* phase, double total) {
  if (!g_env || !g_pinch) return false;
  napi_handle_scope scope = nullptr;
  if (napi_open_handle_scope(g_env, &scope) != napi_ok) return false;
  napi_value args[2] = {nullptr, nullptr};
  napi_create_string_utf8(g_env, phase, NAPI_AUTO_LENGTH, &args[0]);
  napi_create_double(g_env, total, &args[1]);
  napi_value response = nullptr;
  bool taken = false;
  if (Invoke(g_pinch, 2, args, &response) && response) {
    napi_valuetype type = napi_undefined;
    napi_typeof(g_env, response, &type);
    if (type == napi_boolean) napi_get_value_bool(g_env, response, &taken);
  }
  napi_close_handle_scope(g_env, scope);
  return taken;
}

void ResetPinch() {
  g_pinchTotal = 0.0;
  g_pinchAsked = false;
  g_pinchTaken = false;
}

bool MonitorMagnify(NSEvent* event) {
  if (HasPhase(event.phase, NSEventPhaseBegan)) {
    ResetPinch();
    return false;
  }
  const bool ended = HasPhase(event.phase, NSEventPhaseEnded);
  const bool cancelled = HasPhase(event.phase, NSEventPhaseCancelled);
  if (ended || cancelled) {
    if (g_pinchTaken) ReportPinch(cancelled ? "cancel" : "end", g_pinchTotal);
    ResetPinch();
    // Always let the end through so Chromium closes the pinch it saw begin.
    return false;
  }
  g_pinchTotal += event.magnification;
  if (!g_pinchAsked) {
    // A small dead zone so a resting pair of fingers doesn't claim the gesture.
    if (std::abs(g_pinchTotal) < kPinchStartThreshold) return false;
    g_pinchAsked = true;
    g_pinchTaken = ReportPinch("begin", g_pinchTotal);
    return g_pinchTaken;
  }
  if (!g_pinchTaken) return false;
  ReportPinch("change", g_pinchTotal);
  return true;
}

void ReleaseReference(napi_ref* reference) {
  if (g_env && *reference) napi_delete_reference(g_env, *reference);
  *reference = nullptr;
}

void StopMonitor() {
  if (g_scrollMonitor) {
    [NSEvent removeMonitor:g_scrollMonitor];
    g_scrollMonitor = nil;
  }
  if (g_magnifyMonitor) {
    [NSEvent removeMonitor:g_magnifyMonitor];
    g_magnifyMonitor = nil;
  }
  ResetPinch();
  ClearTracking(false);
  g_pendingDelta = NSZeroSize;
  g_pendingRefused = false;
}

void ReleaseCallbacks() {
  ReleaseReference(&g_begin);
  ReleaseReference(&g_progress);
  ReleaseReference(&g_end);
  ReleaseReference(&g_pinch);
  if (g_env && g_async) {
    napi_async_destroy(g_env, g_async);
    g_async = nullptr;
  }
  ReleaseReference(&g_resource);
}

void CleanupEnvironment(void*) {
  g_cleanupHook = false;
  StopMonitor();
  ReleaseCallbacks();
  g_env = nullptr;
}

bool StoreCallback(napi_env env, napi_value options, const char* name, napi_ref* target) {
  napi_value value = nullptr;
  if (napi_get_named_property(env, options, name, &value) != napi_ok) return false;
  napi_valuetype type = napi_undefined;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_function) return false;
  return napi_create_reference(env, value, 1, target) == napi_ok;
}

napi_value Start(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1] = {nullptr};
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 1) {
    napi_throw_type_error(env, nullptr, "start expects callbacks");
    return nullptr;
  }

  g_env = env;
  StopMonitor();
  ReleaseCallbacks();
  if (!StoreCallback(env, argv[0], "onBegin", &g_begin) ||
      !StoreCallback(env, argv[0], "onProgress", &g_progress) ||
      !StoreCallback(env, argv[0], "onEnd", &g_end) ||
      !StoreCallback(env, argv[0], "onPinch", &g_pinch)) {
    ReleaseCallbacks();
    napi_throw_type_error(env, nullptr, "start expects onBegin, onProgress, onEnd, and onPinch functions");
    return nullptr;
  }

  napi_value resource = nullptr;
  napi_value resourceName = nullptr;
  if (napi_create_object(env, &resource) != napi_ok ||
      napi_create_string_utf8(env, "surffish.macTrackpadSwipe", NAPI_AUTO_LENGTH, &resourceName) != napi_ok ||
      napi_async_init(env, resource, resourceName, &g_async) != napi_ok ||
      napi_create_reference(env, resource, 1, &g_resource) != napi_ok) {
    ReleaseCallbacks();
    napi_throw_error(env, nullptr, "could not prepare native swipe callbacks");
    return nullptr;
  }

  if (!g_cleanupHook && napi_add_env_cleanup_hook(env, CleanupEnvironment, nullptr) == napi_ok) {
    g_cleanupHook = true;
  }

  if (!g_scrollMonitor) {
    g_scrollMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel
                                                            handler:^NSEvent*(NSEvent* event) {
      if (!g_env) return event;
      return MonitorScrollWheel(event) ? nil : event;
    }];
  }

  if (!g_magnifyMonitor) {
    g_magnifyMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskMagnify
                                                             handler:^NSEvent*(NSEvent* event) {
      if (!g_env) return event;
      return MonitorMagnify(event) ? nil : event;
    }];
  }

  if (!g_scrollMonitor) {
    ReleaseCallbacks();
    napi_throw_error(env, nullptr, "could not install the macOS scroll monitor");
    return nullptr;
  }

  return nullptr;
}

napi_value Stop(napi_env env, napi_callback_info) {
  if (g_cleanupHook) {
    napi_remove_env_cleanup_hook(env, CleanupEnvironment, nullptr);
    g_cleanupHook = false;
  }
  StopMonitor();
  ReleaseCallbacks();
  return nullptr;
}

napi_value IsSwipeTrackingEnabled(napi_env env, napi_callback_info) {
  napi_value result = nullptr;
  napi_get_boolean(env, NSEvent.swipeTrackingFromScrollEventsEnabled, &result);
  return result;
}

napi_value Initialize(napi_env env, napi_value exports) {
  const napi_property_descriptor methods[] = {
      {"start", nullptr, Start, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"stop", nullptr, Stop, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"isSwipeTrackingEnabled", nullptr, IsSwipeTrackingEnabled, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(methods) / sizeof(methods[0]), methods);
  return exports;
}

}  // namespace

NAPI_MODULE(mac_trackpad_swipe, Initialize)
