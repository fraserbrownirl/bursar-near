import Foundation
import LocalAuthentication

let accessGroup = ""

@main
struct BursarSignerMain {
    static func main() {
        let args = Array(CommandLine.arguments.dropFirst())
        switch args.first {
        case "selftest":
            selftest()
        case "fields":
            let payload = String(data: FileHandle.standardInput.readDataToEndOfFile(), encoding: .utf8) ?? ""
            if payload.isEmpty { fail("payload") }
            let prepared = BursarEnclave.prepare(payload: payload)
            let body: [String: String] = [
                "client_data_json": prepared.clientDataJSON,
                "authenticator_data": base64url(prepared.authenticatorData),
                "message_hex": prepared.message.map { String(format: "%02x", $0) }.joined(),
            ]
            let data = try! JSONSerialization.data(withJSONObject: body)
            FileHandle.standardOutput.write(data)
        case "account":
            account()
        case "sign":
            sign()
        default:
            fail("usage: bursar-signer account|sign|fields")
        }
    }
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("STOP: \(message)\n".utf8))
    exit(1)
}

func selftest() {
    let empty = BursarEnclave.keccak256([])
    let want = "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    let got = empty.map { String(format: "%02x", $0) }.joined()
    if got != want { fail("keccak \(got)") }
    print("ok")
}

func account() {
    do {
        let key = try BursarEnclave.loadOrCreate(accessGroup: accessGroup)
        let publicKey = BursarEnclave.publicKey64(key)
        let id = BursarEnclave.implicitAccount(publicKey: publicKey)
        let line = id + "\n" + BursarEnclave.p256Text(publicKey: publicKey) + "\n"
        FileHandle.standardOutput.write(Data(line.utf8))
    } catch {
        fail("account \(error)")
    }
}

/// Every payment asks the owner's finger once. `BURSAR_SIGNING_BYPASS=1` skips
/// the prompt for tests and unattended builds, and says so on stderr.
func approveBiometrics() {
    if ProcessInfo.processInfo.environment["BURSAR_SIGNING_BYPASS"] == "1" {
        FileHandle.standardError.write(Data("signing without Touch ID (BURSAR_SIGNING_BYPASS set)\n".utf8))
        return
    }
    let context = LAContext()
    var error: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
        fail("touch id unavailable")
    }
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false
    context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "Bursar signs this payment with your Secure Enclave key.") { ok, _ in
        granted = ok
        semaphore.signal()
    }
    semaphore.wait()
    if !granted { fail("touch id") }
}

func sign() {
    let message = FileHandle.standardInput.readDataToEndOfFile()
    if message.isEmpty { fail("message") }
    approveBiometrics()
    do {
        let signature = try BursarEnclave.sign(message: message, accessGroup: accessGroup)
        FileHandle.standardOutput.write(signature)
    } catch {
        fail("sign \(error)")
    }
}

