import AppKit

public func setupApplicationMenu() {
    let mainMenu = NSMenu()
    
    // 1. App Menu
    let appMenuItem = NSMenuItem()
    mainMenu.addItem(appMenuItem)
    let appMenu = NSMenu(title: "Surffish")
    appMenuItem.submenu = appMenu
    
    appMenu.addItem(NSMenuItem(title: "About Surffish", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: ""))
    appMenu.addItem(NSMenuItem(title: "Settings…", action: #selector(MainWindowController.menuOpenSettings), keyEquivalent: ","))
    appMenu.addItem(NSMenuItem.separator())
    appMenu.addItem(NSMenuItem(title: "Hide Surffish", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"))
    let hideOthers = NSMenuItem(title: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
    hideOthers.keyEquivalentModifierMask = [.command, .option]
    appMenu.addItem(hideOthers)
    appMenu.addItem(NSMenuItem(title: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: ""))
    appMenu.addItem(NSMenuItem.separator())
    appMenu.addItem(NSMenuItem(title: "Quit Surffish", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    
    // 2. File Menu
    let fileMenuItem = NSMenuItem()
    mainMenu.addItem(fileMenuItem)
    let fileMenu = NSMenu(title: "File")
    fileMenuItem.submenu = fileMenu
    
    fileMenu.addItem(NSMenuItem(title: "New Tab", action: #selector(MainWindowController.menuNewTab), keyEquivalent: "t"))
    fileMenu.addItem(NSMenuItem(title: "Close Tab", action: #selector(MainWindowController.menuCloseTab), keyEquivalent: "w"))
    
    // 3. Edit Menu (Standard text shortcuts Cmd+Z, Cmd+X, Cmd+C, Cmd+V, Cmd+A)
    let editMenuItem = NSMenuItem()
    mainMenu.addItem(editMenuItem)
    let editMenu = NSMenu(title: "Edit")
    editMenuItem.submenu = editMenu
    
    editMenu.addItem(NSMenuItem(title: "Undo", action: #selector(UndoManager.undo), keyEquivalent: "z"))
    editMenu.addItem(NSMenuItem(title: "Redo", action: #selector(UndoManager.redo), keyEquivalent: "Z"))
    editMenu.addItem(NSMenuItem.separator())
    editMenu.addItem(NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
    editMenu.addItem(NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
    editMenu.addItem(NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
    editMenu.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
    
    // 4. View Menu
    let viewMenuItem = NSMenuItem()
    mainMenu.addItem(viewMenuItem)
    let viewMenu = NSMenu(title: "View")
    viewMenuItem.submenu = viewMenu
    
    viewMenu.addItem(NSMenuItem(title: "Reload Page", action: #selector(MainWindowController.menuReload), keyEquivalent: "r"))
    viewMenu.addItem(NSMenuItem(title: "Toggle Sidebar", action: #selector(MainWindowController.menuToggleSidebar), keyEquivalent: "\\"))
    viewMenu.addItem(NSMenuItem(title: "Focus Address Bar", action: #selector(MainWindowController.menuFocusAddress), keyEquivalent: "l"))
    let developerToolsItem = NSMenuItem(title: "Developer Tools", action: #selector(MainWindowController.menuOpenDeveloperTools), keyEquivalent: "i")
    developerToolsItem.keyEquivalentModifierMask = [.command, .option]
    viewMenu.addItem(developerToolsItem)
    
    // 5. Testing Menu — development-only hooks are intentionally outside browser chrome.
    let testingMenuItem = NSMenuItem()
    mainMenu.addItem(testingMenuItem)
    let testingMenu = NSMenu(title: "Testing")
    testingMenuItem.submenu = testingMenu
    testingMenu.addItem(NSMenuItem(title: "Diagnostics…", action: #selector(MainWindowController.menuShowDiagnostics), keyEquivalent: ""))
    testingMenu.addItem(NSMenuItem.separator())
    testingMenu.addItem(NSMenuItem(title: "Test Ad Blocker", action: #selector(MainWindowController.menuTestAdBlock), keyEquivalent: ""))
    testingMenu.addItem(NSMenuItem(title: "Install Extension…", action: #selector(MainWindowController.menuTestInstallExtension), keyEquivalent: ""))
    testingMenu.addItem(NSMenuItem(title: "Test Touch ID", action: #selector(MainWindowController.menuTestTouchID), keyEquivalent: ""))

    // 6. Window Menu
    let winMenuItem = NSMenuItem()
    mainMenu.addItem(winMenuItem)
    let winMenu = NSMenu(title: "Window")
    winMenuItem.submenu = winMenu
    winMenu.addItem(NSMenuItem(title: "Minimize", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m"))
    winMenu.addItem(NSMenuItem(title: "Zoom", action: #selector(NSWindow.zoom(_:)), keyEquivalent: ""))
    
    NSApp.mainMenu = mainMenu
}
