// BigInt round-tripping for /tmp/contracts.json, shared by ctscan.js (writer)
// and ctsolve.js (reader).
//
// This is a separate module rather than an import between those two because
// Netscript bills a script for every ns function in its import graph. ctscan
// references ns.codingcontract.getContractType/getData and ctsolve references
// attempt; the pair is split precisely so no single script pays for all three
// (together they exceed 21.8GB). Having ctsolve import ctscan for a constant
// would silently re-merge those budgets and put ctsolve back over the line.
// This file calls no ns function, so importing it is free on both sides.
//
// Why tag at all: JSON.stringify THROWS on a BigInt rather than coercing it,
// which killed ctscan outright after a full 70-host scan had already found 49
// contracts. And a plain toString would round-trip to a string, so a solver
// doing arithmetic on "123" instead of 123n would fail quietly -- a worse
// outcome than the crash.

export const BIGINT_TAG = '__bigint__'

export const bigintReplacer = (_key, value) =>
  typeof value === 'bigint' ? { [BIGINT_TAG]: value.toString() } : value

export const bigintReviver = (_key, value) =>
  value && typeof value === 'object' && typeof value[BIGINT_TAG] === 'string'
    ? BigInt(value[BIGINT_TAG])
    : value
