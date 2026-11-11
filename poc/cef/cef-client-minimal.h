// Copyright (c) 2017 The Chromium Embedded Framework Authors. All rights
// reserved. Use of this source code is governed by a BSD-style license that
// can be found in the LICENSE file.

#ifndef CEF_EXAMPLES_MINIMAL_CLIENT_MINIMAL_H_
#define CEF_EXAMPLES_MINIMAL_CLIENT_MINIMAL_H_

#include "include/cef_client.h"
#include "include/cef_request_handler.h"
#include "include/cef_resource_request_handler.h"

namespace minimal {

// POC client. The AF_UNIX bridge is Linux-only and intentionally kept out of
// Surffish production code; it lets the native CEF IO-thread callback consult
// the existing Ghostery core hosted in a separate Node process.
class Client : public CefClient,
               public CefDisplayHandler,
               public CefLifeSpanHandler,
               public CefRequestHandler,
               public CefResourceRequestHandler {
 public:
  Client();
  Client(const Client&) = delete;
  Client& operator=(const Client&) = delete;

  // CefClient methods:
  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefRequestHandler> GetRequestHandler() override { return this; }

  // CefDisplayHandler methods:
  void OnTitleChange(CefRefPtr<CefBrowser> browser,
                     const CefString& title) override;

  // CefLifeSpanHandler methods:
  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override;
  bool DoClose(CefRefPtr<CefBrowser> browser) override;
  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override;

  // CefRequestHandler methods:
  CefRefPtr<CefResourceRequestHandler> GetResourceRequestHandler(
      CefRefPtr<CefBrowser> browser,
      CefRefPtr<CefFrame> frame,
      CefRefPtr<CefRequest> request,
      bool is_navigation,
      bool is_download,
      const CefString& request_initiator,
      bool& disable_default_handling) override;

  // CefResourceRequestHandler methods:
  cef_return_value_t OnBeforeResourceLoad(
      CefRefPtr<CefBrowser> browser,
      CefRefPtr<CefFrame> frame,
      CefRefPtr<CefRequest> request,
      CefRefPtr<CefCallback> callback) override;

 private:
  IMPLEMENT_REFCOUNTING(Client);
};

}  // namespace minimal

#endif  // CEF_EXAMPLES_MINIMAL_CLIENT_MINIMAL_H_
