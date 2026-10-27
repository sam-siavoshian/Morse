// Native control picker. AX reading/value handling adapted from morluto/rea,
// f061989ad255c994e0e2eec072150b5374a2c5f5 (MIT; see rea/LICENSE).
import AppKit
import ApplicationServices

func attribute(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, key as CFString, &value) == .success ? value : nil
}
func bounds(_ element: AXUIElement) -> CGRect? {
    guard let p = attribute(element, kAXPositionAttribute), let s = attribute(element, kAXSizeAttribute),
          CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero; var size = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size) else { return nil }
    return CGRect(origin: point, size: size)
}
func role(_ e: AXUIElement) -> String { attribute(e, kAXRoleAttribute) as? String ?? "Control" }
func isWeb(_ element: AXUIElement) -> Bool {
    var current: AXUIElement? = element
    for _ in 0..<80 {
        guard let e = current else { break }
        if role(e) == "AXWebArea" { return true }
        guard let parent = attribute(e, kAXParentAttribute), CFGetTypeID(parent) == AXUIElementGetTypeID() else { break }
        current = (parent as! AXUIElement)
    }
    return false
}
func emit(_ data: [String: Any]) {
    if let bytes = try? JSONSerialization.data(withJSONObject: data), let line = String(data: bytes, encoding: .utf8) { print(line); fflush(stdout) }
}
let args = CommandLine.arguments
if args.contains("--check") { emit(["trusted": AXIsProcessTrusted()]); exit(0) }
let pid = args.count >= 3 ? (Int32(args[2]) ?? 0) : 0
let target = NSRunningApplication(processIdentifier: pid)
guard pid > 0, target != nil else { emit(["error": "The selected app is no longer running."]); exit(1) }
guard AXIsProcessTrusted() else {
    emit(["error": "Allow Morse in System Settings → Privacy & Security → Accessibility, then try again.", "code": "accessibility-denied"]); exit(2)
}
let application = AXUIElementCreateApplication(pid)
AXUIElementSetMessagingTimeout(application, 0.3)
let screenTop = NSScreen.screens.first?.frame.maxY ?? 0
func hit() -> AXUIElement? {
    let p = NSEvent.mouseLocation
    var e: AXUIElement?
    guard AXUIElementCopyElementAtPosition(application, Float(p.x), Float(screenTop - p.y), &e) == .success,
          let element = e else { return nil }
    var owner: pid_t = 0
    guard AXUIElementGetPid(element, &owner) == .success, owner == pid else { return nil }
    return element
}
if args[1] == "--probe" {
    let e = hit()
    emit(["native": e.map { !isWeb($0) } ?? true]); exit(0)
}
guard args[1] == "--pick" else { exit(1) }
if !args.contains("--watch-web") { target!.activate(options: []) }

final class Highlight: NSView {
    override func draw(_ dirtyRect: NSRect) {
        NSColor.systemTeal.setStroke()
        let p = NSBezierPath(roundedRect: bounds.insetBy(dx: 2, dy: 2), xRadius: 5, yRadius: 5)
        p.lineWidth = 3; p.stroke()
    }
}
final class Panel: NSPanel { override var canBecomeKey: Bool { true } }
final class Picker: NSObject, NSApplicationDelegate {
    var overlay: NSPanel!
    var panel: Panel!
    var timer: Timer?
    var monitors: [Any] = []
    var selected: AXUIElement?
    var frozen = false
    var activated = false
    var label = NSTextField(labelWithString: "")
    var status = NSTextField(wrappingLabelWithString: "Hover a native control. Return selects it. Escape closes.")
    var input = NSTextField(string: "")
    var press: NSButton!
    var decrement: NSButton!
    var increment: NSButton!
    var set: NSButton!
    let target: NSRunningApplication
    let pid: Int32
    let launchDate: Date?
    init(target: NSRunningApplication) {
        self.target = target; self.pid = target.processIdentifier; self.launchDate = target.launchDate
        super.init()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        overlay = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        overlay.isOpaque = false; overlay.backgroundColor = .clear; overlay.hasShadow = false
        overlay.ignoresMouseEvents = true; overlay.level = .floating
        overlay.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        overlay.contentView = Highlight()
        panel = Panel(contentRect: CGRect(x: 0, y: 0, width: 480, height: 214), styleMask: [.titled, .closable, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = "Morse · \(target.localizedName ?? "Native controls")"
        panel.level = .floating; panel.isFloatingPanel = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isReleasedWhenClosed = false
        panel.delegate = self
        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        panel.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: panel.contentView!.leadingAnchor, constant: 18), stack.trailingAnchor.constraint(equalTo: panel.contentView!.trailingAnchor, constant: -18), stack.topAnchor.constraint(equalTo: panel.contentView!.topAnchor, constant: 16)])
        label.font = .boldSystemFont(ofSize: 14); label.lineBreakMode = .byTruncatingTail
        input.placeholderString = "New control value"
        stack.addArrangedSubview(label); stack.addArrangedSubview(status); stack.addArrangedSubview(input)
        let buttons = NSStackView(); buttons.spacing = 8
        press = NSButton(title: "Press", target: self, action: #selector(doPress))
        decrement = NSButton(title: "−", target: self, action: #selector(doDecrement))
        increment = NSButton(title: "+", target: self, action: #selector(doIncrement))
        set = NSButton(title: "Set value", target: self, action: #selector(doSet))
        for b in [press!, decrement!, increment!, set!, NSButton(title: "Pick again", target: self, action: #selector(pickAgain))] { buttons.addArrangedSubview(b) }
        stack.addArrangedSubview(buttons)
        for v in [label, status, input] { v.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true }
        if let screen = NSScreen.main { panel.setFrameOrigin(CGPoint(x: screen.visibleFrame.midX - 240, y: screen.visibleFrame.minY + 30)) }
        if !args.contains("--watch-web") { panel.orderFrontRegardless() }
        // Local monitoring consumes Return/Escape while the panel has focus.
        if let m = NSEvent.addLocalMonitorForEvents(matching: [.keyDown], handler: { [weak self] event in
            guard let self else { return event }
            if event.keyCode == 53 { NSApp.terminate(nil); return nil }
            if event.keyCode == 36 && !self.frozen { self.pin(); return nil }
            return event
        }) { monitors.append(m) }
        // The picker takes keyboard focus, but never sends a click to the target.
        if !args.contains("--watch-web") { panel.makeKey(); NSApp.activate(ignoringOtherApps: true); activated = true }
        timer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in self?.tick() }
        tick()
    }
    func valid() -> Bool { !target.isTerminated && NSRunningApplication(processIdentifier: pid)?.launchDate == launchDate }
    func tick() {
        guard valid() else { NSApp.terminate(nil); return }
        guard !frozen else { return }
        if panel.frame.contains(NSEvent.mouseLocation) { return }
        guard let e = hit(), !isWeb(e), let r = bounds(e), r.width > 0, r.height > 0 else {
            selected = nil; overlay.orderOut(nil); if args.contains("--watch-web") { panel.orderOut(nil); activated = false }; label.stringValue = "Point at the app’s toolbar, tabs, or controls"
            updateButtons([]); return
        }
        selected = e
        panel.orderFrontRegardless()
        if !activated { panel.makeKey(); NSApp.activate(ignoringOtherApps: true); activated = true }
        overlay.setFrame(CGRect(x: r.minX - 3, y: screenTop - r.maxY - 3, width: r.width + 6, height: r.height + 6), display: true)
        overlay.orderFrontRegardless()
        let name = (attribute(e, kAXTitleAttribute) as? String).flatMap { $0.isEmpty ? nil : $0 }
            ?? attribute(e, kAXDescriptionAttribute) as? String ?? role(e)
        label.stringValue = name
        updateButtons([])
    }
    func pin() {
        guard let e = selected else { return }
        frozen = true
        var names: CFArray?
        AXUIElementCopyActionNames(e, &names)
        updateButtons(names as? [String] ?? [])
        var writable = DarwinBoolean(false)
        let canSet = AXUIElementIsAttributeSettable(e, kAXValueAttribute as CFString, &writable) == .success && writable.boolValue
        let secure = (attribute(e, kAXSubroleAttribute) as? String) == "AXSecureTextField"
        set.isEnabled = canSet && !secure; input.isEnabled = canSet && !secure
        if !secure { let value = captureAccessibilityValue(attribute(e, kAXValueAttribute)).value; input.stringValue = value is NSNull ? "" : String(describing: value) }
        status.stringValue = "Selected \(role(e)). Only actions exposed by this app are available."
        panel.makeKey(); panel.makeFirstResponder(input.isEnabled ? input : press)
    }
    func updateButtons(_ actions: [String]) {
        press.isEnabled = frozen && actions.contains(kAXPressAction)
        decrement.isEnabled = frozen && actions.contains(kAXDecrementAction)
        increment.isEnabled = frozen && actions.contains(kAXIncrementAction)
        if !frozen { set.isEnabled = false; input.isEnabled = false }
    }
    @objc func pickAgain() { frozen = false; selected = nil; input.stringValue = ""; status.stringValue = "Hover a native control. Return selects it. Escape closes."; panel.makeFirstResponder(nil); tick() }
    func apply(_ action: String?) {
        guard frozen, valid(), let e = selected else { status.stringValue = "Select the control again."; return }
        var owner: pid_t = 0
        guard AXUIElementGetPid(e, &owner) == .success && owner == pid else { status.stringValue = "The control is no longer available."; return }
        let result = action.map { AXUIElementPerformAction(e, $0 as CFString) }
            ?? AXUIElementSetAttributeValue(e, kAXValueAttribute as CFString, input.stringValue as CFString)
        status.stringValue = result == .success ? "Action completed." : "The app rejected this action (\(result.rawValue)). Pick the control again."
    }
    @objc func doPress() { apply(kAXPressAction) }
    @objc func doIncrement() { apply(kAXIncrementAction) }
    @objc func doDecrement() { apply(kAXDecrementAction) }
    @objc func doSet() { apply(nil) }
    func applicationWillTerminate(_ notification: Notification) { timer?.invalidate(); for m in monitors { NSEvent.removeMonitor(m) } }
}
extension Picker: NSWindowDelegate { func windowWillClose(_ notification: Notification) { NSApp.terminate(nil) } }
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let picker = Picker(target: target!); app.delegate = picker
app.run()
