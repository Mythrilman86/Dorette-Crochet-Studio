import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

class StudioViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(StudioFilesPlugin())
    }
}

@objc(StudioFilesPlugin)
class StudioFilesPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    let identifier = "StudioFilesPlugin"
    let jsName = "StudioFiles"
    let pluginMethods = ["begin", "append", "discard", "save", "openGuide"].map {
        CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise)
    }

    private var folder: URL?
    private var exportCall: CAPPluginCall?
    private var guideViewer: UIDocumentInteractionController?

    @objc func begin(_ call: CAPPluginCall) {
        guard folder == nil else {
            call.reject("Another export is in progress.")
            return
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false)
            try Data().write(to: url.appendingPathComponent("export"))
            folder = url
            call.resolve()
        } catch {
            try? FileManager.default.removeItem(at: url)
            call.reject("Could not prepare the export.", nil, error)
        }
    }

    @objc func append(_ call: CAPPluginCall) {
        guard let folder, let text = call.getString("data"), let data = Data(base64Encoded: text) else {
            call.reject("Export data unavailable.")
            return
        }
        do {
            let file = try FileHandle(forWritingTo: folder.appendingPathComponent("export"))
            defer { try? file.close() }
            try file.seekToEnd()
            try file.write(contentsOf: data)
            call.resolve()
        } catch {
            call.reject("Could not prepare the export.", nil, error)
        }
    }

    @objc func discard(_ call: CAPPluginCall) {
        if let folder { try? FileManager.default.removeItem(at: folder) }
        folder = nil
        call.resolve()
    }

    @objc func save(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let folder = self.folder, let name = call.getString("name"),
                  !name.isEmpty, name == (name as NSString).lastPathComponent,
                  name != ".", name != "..",
                  let presenter = self.bridge?.viewController, presenter.presentedViewController == nil else {
                call.reject("Could not open the Files picker.")
                return
            }
            do {
                let destination = folder.appendingPathComponent(name)
                try FileManager.default.moveItem(at: folder.appendingPathComponent("export"), to: destination)
                let picker = UIDocumentPickerViewController(forExporting: [destination], asCopy: true)
                picker.delegate = self
                self.exportCall = call
                presenter.present(picker, animated: true)
            } catch {
                call.reject("Could not prepare the export.", nil, error)
            }
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        finishPicker(saved: !urls.isEmpty)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finishPicker(saved: false)
    }

    private func finishPicker(saved: Bool) {
        exportCall?.resolve(["saved": saved])
        exportCall = nil
    }

    @objc func openGuide(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = Bundle.main.url(forResource: "Dorette-Crochet-Studio-User-Guide",
                                            withExtension: "pdf", subdirectory: "public") else {
                call.reject("The bundled guide is unavailable.")
                return
            }
            let viewer = UIDocumentInteractionController(url: url)
            viewer.delegate = self
            self.guideViewer = viewer
            if viewer.presentPreview(animated: true) {
                call.resolve()
            } else {
                self.guideViewer = nil
                call.reject("Could not open the guide.")
            }
        }
    }
}

extension StudioFilesPlugin: UIDocumentInteractionControllerDelegate {
    func documentInteractionControllerViewControllerForPreview(_ controller: UIDocumentInteractionController) -> UIViewController {
        bridge?.viewController ?? UIViewController()
    }

    func documentInteractionControllerDidEndPreview(_ controller: UIDocumentInteractionController) {
        guideViewer = nil
    }
}
