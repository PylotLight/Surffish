// Copyright (c) 2017 The Chromium Embedded Framework Authors. All rights
// reserved. Use of this source code is governed by a BSD-style license that
// can be found in the LICENSE file.

#include "examples/minimal/client_minimal.h"
#include "examples/shared/app_factory.h"
#include "examples/shared/browser_util.h"
#include "include/cef_command_line.h"

namespace minimal {

namespace {

constexpr char kStartupURL[] = "https://www.google.com";

}  // namespace

// Minimal implementation of CefApp for the browser process.
class BrowserApp : public CefApp, public CefBrowserProcessHandler {
 public:
  BrowserApp() = default;
  BrowserApp(const BrowserApp&) = delete;
  BrowserApp& operator=(const BrowserApp&) = delete;

  CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override {
    return this;
  }

  void OnBeforeCommandLineProcessing(
      const CefString& process_type,
      CefRefPtr<CefCommandLine> command_line) override {
    if (process_type.empty()) {
      command_line->AppendSwitch("enable-chrome-runtime");
#if defined(OS_MACOSX)
      command_line->AppendSwitch("use-mock-keychain");
#endif
    }
  }

  void OnContextInitialized() override {
    CefRefPtr<CefCommandLine> command_line =
        CefCommandLine::GetGlobalCommandLine();
    CefString startup_url = kStartupURL;
    if (command_line && command_line->HasSwitch("url")) {
      startup_url = command_line->GetSwitchValue("url");
    }
    shared::CreateBrowser(new Client(), startup_url, CefBrowserSettings());
  }

 private:
  IMPLEMENT_REFCOUNTING(BrowserApp);
};

}  // namespace minimal

namespace shared {

CefRefPtr<CefApp> CreateBrowserProcessApp() {
  return new minimal::BrowserApp();
}

}  // namespace shared
