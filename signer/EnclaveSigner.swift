import CryptoKit
import Foundation
import Security

/// P-256 key in the Secure Enclave, and the WebAuthn assertion Intents verifies.
/// The Mac helper and the iPhone app both compile this file. The private key is not exported.
enum BursarEnclave {
    static let rpId = "app.bursar.phone"
    static let origin = "https://app.bursar.phone"
    static let tag = Data("bursar.p256.v1".utf8)

    struct Prepared: Equatable {
        var clientDataJSON: String
        var authenticatorData: Data
        var message: Data
    }

    /// `0x` plus the last 20 bytes of keccak256(`p256` || 64-byte x||y). Observed on the Intents P-256 test vector.
    static func implicitAccount(publicKey: Data) -> String {
        precondition(publicKey.count == 64)
        var input = Array("p256".utf8)
        input.append(contentsOf: publicKey)
        let digest = keccak256(input)
        return "0x" + digest.suffix(20).map { String(format: "%02x", $0) }.joined()
    }

    static func p256Text(publicKey: Data) -> String {
        "p256:" + base58(publicKey)
    }

    /// Challenge is base64url(sha256(payload)). The signed bytes are authenticatorData || sha256(clientDataJSON).
    static func prepare(payload: String) -> Prepared {
        let payloadHash = SHA256.hash(data: Data(payload.utf8))
        let challenge = base64url(Data(payloadHash))
        let client = "{\"type\":\"webauthn.get\",\"challenge\":\"\(challenge)\",\"origin\":\"\(origin)\"}"
        let clientHash = SHA256.hash(data: Data(client.utf8))
        var authenticator = Data(SHA256.hash(data: Data(rpId.utf8)))
        authenticator.append(0x05)
        authenticator.append(contentsOf: [0, 0, 0, 0])
        var message = authenticator
        message.append(contentsOf: clientHash)
        return Prepared(clientDataJSON: client, authenticatorData: authenticator, message: message)
    }

    /// The Secure Enclave key. `dataRepresentation` is an opaque device-bound blob, not a seed.
    static func loadOrCreate(accessGroup: String) throws -> SecureEnclave.P256.Signing.PrivateKey {
        if let blob = wrappedBlob(accessGroup: accessGroup) {
            return try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: blob)
        }
        var error: Unmanaged<CFError>?
        guard let control = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            [.privateKeyUsage, .biometryCurrentSet],
            &error
        ) else { throw error?.takeRetainedValue() ?? EnclaveError.access }
        let key = try SecureEnclave.P256.Signing.PrivateKey(accessControl: control)
        try storeWrappedBlob(key.dataRepresentation, accessGroup: accessGroup)
        return key
    }

    static func publicKey64(_ key: SecureEnclave.P256.Signing.PrivateKey) -> Data {
        key.publicKey.rawRepresentation
    }

    /// Signs inside the Secure Enclave. Returns raw r||s. The caller passes the WebAuthn message bytes.
    static func sign(message: Data, accessGroup: String) throws -> Data {
        let key = try loadOrCreate(accessGroup: accessGroup)
        let signature = try key.signature(for: message)
        let raw = signature.rawRepresentation
        if raw.count != 64 { throw EnclaveError.sign }
        return raw
    }

    private static func wrappedQuery(accessGroup: String, returning: Bool) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "bursar.p256.wrapped",
            kSecAttrAccount as String: "bursar",
        ]
        if !accessGroup.isEmpty { query[kSecAttrAccessGroup as String] = accessGroup }
        if returning {
            query[kSecReturnData as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne
        }
        return query
    }

    private static func wrappedBlob(accessGroup: String) -> Data? {
        var result: CFTypeRef?
        guard SecItemCopyMatching(wrappedQuery(accessGroup: accessGroup, returning: true) as CFDictionary, &result) == errSecSuccess else {
            return nil
        }
        return result as? Data
    }

    private static func storeWrappedBlob(_ blob: Data, accessGroup: String) throws {
        var add = wrappedQuery(accessGroup: accessGroup, returning: false)
        add[kSecValueData as String] = blob
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        if status != errSecSuccess && status != errSecDuplicateItem { throw EnclaveError.create }
    }

    static func keccak256(_ input: [UInt8]) -> [UInt8] {
        var state = [UInt64](repeating: 0, count: 25)
        let rate = 136
        var offset = 0
        while offset + rate <= input.count {
            absorb(&state, input, offset, rate)
            permute(&state)
            offset += rate
        }
        var block = [UInt8](repeating: 0, count: rate)
        for i in 0..<(input.count - offset) { block[i] = input[offset + i] }
        block[input.count - offset] = 0x01
        block[rate - 1] |= 0x80
        absorb(&state, block, 0, rate)
        permute(&state)
        var out = [UInt8](repeating: 0, count: 32)
        for i in 0..<32 { out[i] = UInt8((state[i / 8] >> ((i % 8) * 8)) & 0xff) }
        return out
    }
}

enum EnclaveError: Error { case access, create, publicKey, missing, sign }

private func absorb(_ state: inout [UInt64], _ bytes: [UInt8], _ offset: Int, _ length: Int) {
    for i in 0..<length {
        state[i / 8] ^= UInt64(bytes[offset + i]) << ((i % 8) * 8)
    }
}

private func rotl(_ x: UInt64, _ n: Int) -> UInt64 { (x << n) | (x >> (64 - n)) }

private func permute(_ a: inout [UInt64]) {
    let rc: [UInt64] = [
        0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
        0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
        0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
        0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
        0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
        0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
    ]
    let rot: [Int] = [
        0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
    ]
    for round in 0..<24 {
        var c = [UInt64](repeating: 0, count: 5)
        for x in 0..<5 { c[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20] }
        var d = [UInt64](repeating: 0, count: 5)
        for x in 0..<5 { d[x] = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1) }
        for i in 0..<25 { a[i] ^= d[i % 5] }
        var b = [UInt64](repeating: 0, count: 25)
        for i in 0..<25 {
            let x = i % 5
            let y = i / 5
            b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(a[i], rot[i])
        }
        for y in 0..<5 {
            for x in 0..<5 {
                a[x + 5 * y] = b[x + 5 * y] ^ ((~b[((x + 1) % 5) + 5 * y]) & b[((x + 2) % 5) + 5 * y])
            }
        }
        a[0] ^= rc[round]
    }
}

private func base58(_ data: Data) -> String {
    let alphabet = Array("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
    var zeroes = 0
    for byte in data {
        if byte == 0 { zeroes += 1 } else { break }
    }
    var digits = [UInt8](repeating: 0, count: data.count * 2)
    var length = 0
    for byte in data {
        var carry = Int(byte)
        var i = 0
        var cursor = digits.count - 1
        while (carry != 0 || i < length) && cursor >= 0 {
            carry += 256 * Int(digits[cursor])
            digits[cursor] = UInt8(carry % 58)
            carry /= 58
            i += 1
            cursor -= 1
        }
        length = i
    }
    var start = 0
    while start < digits.count && digits[start] == 0 { start += 1 }
    return String(repeating: "1", count: zeroes) + digits[start...].map { String(alphabet[Int($0)]) }.joined()
}

func base64url(_ data: Data) -> String {
    data.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

