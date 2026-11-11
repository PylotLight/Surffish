// Copyright (c) 2017 The Chromium Embedded Framework Authors. All rights
// reserved. Use of this source code is governed by a BSD-style license that
// can be found in the LICENSE file.

#include "examples/minimal/client_minimal.h"

#include <sys/socket.h>
#include <sys/time.h>
#include <sys/un.h>
#include <unistd.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#include "examples/shared/client_util.h"
#include "include/cef_request.h"

namespace minimal {
namespace {

std::string ResourceTypeName(cef_resource_type_t type) {
  switch (type) {
    case RT_MAIN_FRAME:
      return "main_frame";
    case RT_SUB_FRAME:
      return "sub_frame";
    case RT_STYLESHEET:
      return "stylesheet";
    case RT_SCRIPT:
      return "script";
    case RT_IMAGE:
      return "image";
    case RT_FONT_RESOURCE:
      return "font";
    case RT_OBJECT:
      return "object";
    case RT_XHR:
      return "xhr";
    case RT_PING:
      return "ping";
    case RT_CSP_REPORT:
      return "csp_report";
    case RT_MEDIA:
      return "media";
    default:
      return "other";
  }
}

bool SendAll(int fd, const std::string& value) {
  size_t sent = 0;
  while (sent < value.size()) {
    const ssize_t result = send(fd, value.data() + sent, value.size() - sent,
                                MSG_NOSIGNAL);
    if (result <= 0) {
      return false;
    }
    sent += static_cast<size_t>(result);
  }
  return true;
}

std::string AskGhostery(const std::string& url,
                        const std::string& frame_url,
                        const std::string& type,
                        uint64_t request_id) {
  const char* socket_path = std::getenv("SURFFISH_CEF_ADBLOCK_SOCKET");
  if (!socket_path || socket_path[0] == '\0') {
    return "ALLOW";
  }

  const int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) {
    return "ALLOW";
  }
  timeval timeout{};
  timeout.tv_sec = 2;
  setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
  setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));

  sockaddr_un address{};
  address.sun_family = AF_UNIX;
  if (std::strlen(socket_path) >= sizeof(address.sun_path)) {
    close(fd);
    return "ALLOW";
  }
  std::strncpy(address.sun_path, socket_path, sizeof(address.sun_path) - 1);
  if (connect(fd, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0) {
    close(fd);
    return "ALLOW";
  }

  // HTTP URLs cannot contain literal tabs or newlines, so a tiny line protocol
  // avoids adding a JSON dependency to the native sample.
  const std::string payload = url + "\t" + frame_url + "\t" + type + "\t" +
                              std::to_string(request_id) + "\n";
  if (!SendAll(fd, payload)) {
    close(fd);
    return "ALLOW";
  }

  std::string response;
  char buffer[1024];
  while (response.size() < 8192) {
    const ssize_t received = recv(fd, buffer, sizeof(buffer), 0);
    if (received <= 0) {
      break;
    }
    response.append(buffer, static_cast<size_t>(received));
    const size_t newline = response.find('\n');
    if (newline != std::string::npos) {
      response.resize(newline);
      break;
    }
  }
  close(fd);
  return response.empty() ? "ALLOW" : response;
}

bool StartsWith(const std::string& value, const char* prefix) {
  return value.rfind(prefix, 0) == 0;
}

}  // namespace

Client::Client() = default;

void Client::OnTitleChange(CefRefPtr<CefBrowser> browser,
                           const CefString& title) {
  shared::OnTitleChange(browser, title);
  const std::string value = title.ToString();
  if (StartsWith(value, "CEF_POC_RESULT:")) {
    std::fprintf(stdout, "CEF_POC_TITLE=%s\n", value.c_str());
    std::fflush(stdout);
    browser->GetHost()->CloseBrowser(true);
  }
}

void Client::OnAfterCreated(CefRefPtr<CefBrowser> browser) {
  shared::OnAfterCreated(browser);
}

bool Client::DoClose(CefRefPtr<CefBrowser> browser) {
  return shared::DoClose(browser);
}

void Client::OnBeforeClose(CefRefPtr<CefBrowser> browser) {
  shared::OnBeforeClose(browser);
}

CefRefPtr<CefResourceRequestHandler> Client::GetResourceRequestHandler(
    CefRefPtr<CefBrowser> browser,
    CefRefPtr<CefFrame> frame,
    CefRefPtr<CefRequest> request,
    bool is_navigation,
    bool is_download,
    const CefString& request_initiator,
    bool& disable_default_handling) {
  return this;
}

cef_return_value_t Client::OnBeforeResourceLoad(
    CefRefPtr<CefBrowser> browser,
    CefRefPtr<CefFrame> frame,
    CefRefPtr<CefRequest> request,
    CefRefPtr<CefCallback> callback) {
  const std::string url = request->GetURL().ToString();
  if (!StartsWith(url, "http://") && !StartsWith(url, "https://")) {
    return RV_CONTINUE;
  }

  const std::string frame_url = frame ? frame->GetURL().ToString() : "";
  const std::string type = ResourceTypeName(request->GetResourceType());
  // Match Surffish's existing extension exemption: never subject extension
  // pages/workers or frame-less worker requests to page-origin adblock rules.
  if (frame_url.empty() || StartsWith(frame_url, "chrome-extension://")) {
    std::fprintf(stderr, "POC_CEF_UNATTRIBUTED\t%s\t%s\t%s\n", type.c_str(),
                 url.c_str(), frame_url.c_str());
    return RV_CONTINUE;
  }

  const std::string decision =
      AskGhostery(url, frame_url, type, request->GetIdentifier());
  if (decision == "BLOCK") {
    std::fprintf(stderr, "POC_CEF_BLOCK\t%s\t%s\n", type.c_str(), url.c_str());
    return RV_CANCEL;
  }

  const size_t separator = decision.find('\t');
  const std::string action = decision.substr(0, separator);
  if ((action == "REDIRECT" || action == "REWRITE") &&
      separator != std::string::npos) {
    request->SetURL(decision.substr(separator + 1));
    std::fprintf(stderr, "POC_CEF_%s\t%s\n", action.c_str(), url.c_str());
  }
  return RV_CONTINUE;
}

}  // namespace minimal
