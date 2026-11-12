#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
swiftc -O -parse-as-library -o signer/bursar-signer signer/EnclaveSigner.swift signer/bursar-signer.swift
# Team 87RRHL5P97. The keychain-access-groups entitlement is in
# bursar-signer.entitlements. Applying it without a Mac provisioning profile
# for this team makes macOS kill the process, and Xcode has no account for the team.
codesign --force --sign "Apple Development: service@act.foundation (87RRHL5P97)" \
  --identifier com.fraserbrown.bursar-signer \
  signer/bursar-signer
codesign --verify --verbose=2 signer/bursar-signer
