// Coding-contract solvers, extracted from contract.js so they can be shared.
//
// This module is deliberately free of any `ns` call: Bitburner charges RAM per
// NS function referenced anywhere in a script's import graph, and the whole
// point of the split is to keep the scanner and the solver each under 16GB.
// Keep it that way — adding one ns call here taxes every importer.
//
// Solver signature: (data) => answer, keyed by the contract type name the game
// reports from ns.codingcontract.getContractType().

function convert2DArrayToString(arr) {
  var components = []
  arr.forEach(function (e) {
    var s = e.toString()
    s = ['[', s, ']'].join('')
    components.push(s)
  })
  return components.join(',').replace(/\s/g, '')
}

export const codingContractTypesMetadata = [
  {
    name: 'Find Largest Prime Factor',
    solver: function (data) {
      var fac = 2
      var n = data
      while (n > (fac - 1) * (fac - 1)) {
        while (n % fac === 0) {
          n = Math.round(n / fac)
        }
        ++fac
      }
      return n === 1 ? fac - 1 : n
    },
    difficulty: 1,
  },
  {
    name: 'Subarray with Maximum Sum',
    solver: function (data) {
      var nums = data.slice()
      for (var i = 1; i < nums.length; i++) {
        nums[i] = Math.max(nums[i], nums[i] + nums[i - 1])
      }
      return Math.max.apply(Math, nums)
    },
    difficulty: 1,
  },
  {
    name: 'Total Ways to Sum',
    solver: function (data) {
      var ways = [1]
      ways.length = data + 1
      ways.fill(0, 1)
      for (var i = 1; i < data; ++i) {
        for (var j = i; j <= data; ++j) {
          ways[j] += ways[j - i]
        }
      }
      return ways[data]
    },
    difficulty: 1.5,
  },
  {
    name: 'Spiralize Matrix',
    solver: function (data, ans) {
      var spiral = []
      var m = data.length
      var n = data[0].length
      var u = 0
      var d = m - 1
      var l = 0
      var r = n - 1
      var k = 0
      while (true) {
        // Up
        for (var col = l; col <= r; col++) {
          spiral[k] = data[u][col]
          ++k
        }
        if (++u > d) {
          break
        }
        // Right
        for (var row = u; row <= d; row++) {
          spiral[k] = data[row][r]
          ++k
        }
        if (--r < l) {
          break
        }
        // Down
        for (var col = r; col >= l; col--) {
          spiral[k] = data[d][col]
          ++k
        }
        if (--d < u) {
          break
        }
        // Left
        for (var row = d; row >= u; row--) {
          spiral[k] = data[row][l]
          ++k
        }
        if (++l > r) {
          break
        }
      }

      return spiral
    },
    difficulty: 2,
  },
  {
    name: 'Array Jumping Game',
    solver: function (data) {
      var n = data.length
      var i = 0
      for (var reach = 0; i < n && i <= reach; ++i) {
        reach = Math.max(i + data[i], reach)
      }
      var solution = i === n
      return solution ? 1 : 0
    },
    difficulty: 2.5,
  },
  {
    name: 'Merge Overlapping Intervals',
    solver: function (data) {
      var intervals = data.slice()
      intervals.sort(function (a, b) {
        return a[0] - b[0]
      })
      var result = []
      var start = intervals[0][0]
      var end = intervals[0][1]
      for (var _i = 0, intervals_1 = intervals; _i < intervals_1.length; _i++) {
        var interval = intervals_1[_i]
        if (interval[0] <= end) {
          end = Math.max(end, interval[1])
        } else {
          result.push([start, end])
          start = interval[0]
          end = interval[1]
        }
      }
      result.push([start, end])
      var sanitizedResult = convert2DArrayToString(result)
      return sanitizedResult
    },
    difficulty: 3,
  },
  {
    name: 'Generate IP Addresses',
    solver: function (data, ans) {
      var ret = []
      for (var a = 1; a <= 3; ++a) {
        for (var b = 1; b <= 3; ++b) {
          for (var c = 1; c <= 3; ++c) {
            for (var d = 1; d <= 3; ++d) {
              if (a + b + c + d === data.length) {
                var A = parseInt(data.substring(0, a), 10)
                var B = parseInt(data.substring(a, a + b), 10)
                var C = parseInt(data.substring(a + b, a + b + c), 10)
                var D = parseInt(data.substring(a + b + c, a + b + c + d), 10)
                if (A <= 255 && B <= 255 && C <= 255 && D <= 255) {
                  var ip = [A.toString(), '.', B.toString(), '.', C.toString(), '.', D.toString()].join('')
                  if (ip.length === data.length + 3) {
                    ret.push(ip)
                  }
                }
              }
            }
          }
        }
      }
      return ret
    },
  },
  {
    name: 'Algorithmic Stock Trader I',
    solver: function (data) {
      var maxCur = 0
      var maxSoFar = 0
      for (var i = 1; i < data.length; ++i) {
        maxCur = Math.max(0, (maxCur += data[i] - data[i - 1]))
        maxSoFar = Math.max(maxCur, maxSoFar)
      }
      return maxSoFar.toString()
    },
    difficulty: 1,
  },
  {
    name: 'Algorithmic Stock Trader II',
    solver: function (data) {
      var profit = 0
      for (var p = 1; p < data.length; ++p) {
        profit += Math.max(data[p] - data[p - 1], 0)
      }
      return profit.toString()
    },
    difficulty: 2,
  },
  {
    name: 'Algorithmic Stock Trader III',
    solver: function (data) {
      var hold1 = Number.MIN_SAFE_INTEGER
      var hold2 = Number.MIN_SAFE_INTEGER
      var release1 = 0
      var release2 = 0
      for (var _i = 0, data_1 = data; _i < data_1.length; _i++) {
        var price = data_1[_i]
        release2 = Math.max(release2, hold2 + price)
        hold2 = Math.max(hold2, release1 - price)
        release1 = Math.max(release1, hold1 + price)
        hold1 = Math.max(hold1, price * -1)
      }
      return release2.toString()
    },
    difficulty: 5,
  },
  {
    name: 'Algorithmic Stock Trader IV',
    solver: function (data) {
      var k = data[0]
      var prices = data[1]
      var len = prices.length
      if (len < 2) {
        return 0
      }
      if (k > len / 2) {
        var res = 0
        for (var i = 1; i < len; ++i) {
          res += Math.max(prices[i] - prices[i - 1], 0)
        }
        return res
      }
      var hold = []
      var rele = []
      hold.length = k + 1
      rele.length = k + 1
      for (var i = 0; i <= k; ++i) {
        hold[i] = Number.MIN_SAFE_INTEGER
        rele[i] = 0
      }
      var cur
      for (var i = 0; i < len; ++i) {
        cur = prices[i]
        for (var j = k; j > 0; --j) {
          rele[j] = Math.max(rele[j], hold[j] + cur)
          hold[j] = Math.max(hold[j], rele[j - 1] - cur)
        }
      }
      return rele[k]
    },
    difficulty: 8,
  },
  {
    name: 'Minimum Path Sum in a Triangle',
    solver: function (data) {
      var n = data.length
      var dp = data[n - 1].slice()
      for (var i = n - 2; i > -1; --i) {
        for (var j = 0; j < data[i].length; ++j) {
          dp[j] = Math.min(dp[j], dp[j + 1]) + data[i][j]
        }
      }
      return dp[0]
    },
    difficulty: 5,
  },
  {
    name: 'Unique Paths in a Grid I',
    solver: function (data) {
      var n = data[0] // Number of rows
      var m = data[1] // Number of columns
      var currentRow = []
      currentRow.length = n
      for (var i = 0; i < n; i++) {
        currentRow[i] = 1
      }
      for (var row = 1; row < m; row++) {
        for (var i = 1; i < n; i++) {
          currentRow[i] += currentRow[i - 1]
        }
      }
      return currentRow[n - 1]
    },
    difficulty: 3,
  },
  {
    name: 'Unique Paths in a Grid II',
    solver: function (data) {
      var obstacleGrid = []
      obstacleGrid.length = data.length
      for (var i = 0; i < obstacleGrid.length; ++i) {
        obstacleGrid[i] = data[i].slice()
      }
      for (var i = 0; i < obstacleGrid.length; i++) {
        for (var j = 0; j < obstacleGrid[0].length; j++) {
          if (obstacleGrid[i][j] == 1) {
            obstacleGrid[i][j] = 0
          } else if (i == 0 && j == 0) {
            obstacleGrid[0][0] = 1
          } else {
            obstacleGrid[i][j] = (i > 0 ? obstacleGrid[i - 1][j] : 0) + (j > 0 ? obstacleGrid[i][j - 1] : 0)
          }
        }
      }
      return obstacleGrid[obstacleGrid.length - 1][obstacleGrid[0].length - 1]
    },
    difficulty: 5,
  },
  {
    name: 'Sanitize Parentheses in Expression',
    solver: function (data) {
      var left = 0
      var right = 0
      var res = []
      for (var i = 0; i < data.length; ++i) {
        if (data[i] === '(') {
          ++left
        } else if (data[i] === ')') {
          left > 0 ? --left : ++right
        }
      }
      function dfs(pair, index, left, right, s, solution, res) {
        if (s.length === index) {
          if (left === 0 && right === 0 && pair === 0) {
            for (var i = 0; i < res.length; i++) {
              if (res[i] === solution) {
                return
              }
            }
            res.push(solution)
          }
          return
        }
        if (s[index] === '(') {
          if (left > 0) {
            dfs(pair, index + 1, left - 1, right, s, solution, res)
          }
          dfs(pair + 1, index + 1, left, right, s, solution + s[index], res)
        } else if (s[index] === ')') {
          if (right > 0) dfs(pair, index + 1, left, right - 1, s, solution, res)
          if (pair > 0) dfs(pair - 1, index + 1, left, right, s, solution + s[index], res)
        } else {
          dfs(pair, index + 1, left, right, s, solution + s[index], res)
        }
      }
      dfs(0, 0, left, right, data, '', res)

      return res
    },
    difficulty: 10,
  },
  {
    name: 'Find All Valid Math Expressions',
    solver: function (data) {
      var num = data[0]
      var target = data[1]
      function helper(res, path, num, target, pos, evaluated, multed) {
        if (pos === num.length) {
          if (target === evaluated) {
            res.push(path)
          }
          return
        }
        for (var i = pos; i < num.length; ++i) {
          if (i != pos && num[pos] == '0') {
            break
          }
          var cur = parseInt(num.substring(pos, i + 1))
          if (pos === 0) {
            helper(res, path + cur, num, target, i + 1, cur, cur)
          } else {
            helper(res, path + '+' + cur, num, target, i + 1, evaluated + cur, cur)
            helper(res, path + '-' + cur, num, target, i + 1, evaluated - cur, -cur)
            helper(res, path + '*' + cur, num, target, i + 1, evaluated - multed + multed * cur, multed * cur)
          }
        }
      }

      if (num == null || num.length === 0) {
        return []
      }
      var result = []
      helper(result, '', num, target, 0, 0, 0)
      return result
    },
    difficulty: 10,
  },
]

// Ported from src/CodingContract/contracts/Encryption.ts getAnswer(). This is
// a difficulty-1 type, so it is one of only five that can spawn before any
// Source-File is owned — roughly a fifth of everything we will see — and the
// original contract.js had no solver for it at all.
codingContractTypesMetadata.push({
  name: 'Encryption I: Caesar Cipher',
  // data = [plaintext, leftShift]
  solver: (data) =>
    [...data[0]]
      .map((c) => (c === ' ' ? c : String.fromCharCode(((c.charCodeAt(0) - 65 - data[1] + 26) % 26) + 65)))
      .join(''),
  difficulty: 1,
})

// ---------------------------------------------------------------------------
// The remaining 13 contract types, added 2026-09-13.
//
// The rule followed for every one of these: **the game's validator is the
// specification, not the problem statement.** Where the validator is
// `getAnswer(data) === answer` the solver below is a direct port of the game's
// own getAnswer, because that is the only way to be provably rather than
// probably right — the game's algorithm may be odd (Array Jumping Game II's
// greedy, Largest Rectangle's histogram expansion) but it *is* the answer key.
// Where the validator accepts any correct answer (Shortest Path, Proper
// 2-Coloring, Compression III's `length <= optimal && decodes back`) the solver
// computes one from scratch, and the round-trip test in
// tools/staging/contracts/ctsolvers.test.mjs is what establishes it is accepted.
//
// Every citation below is file:line in ~/Repos/bitburner at v3.0.2.
//
// A solver here must NEVER return a guessed answer. A wrong attempt burns one
// of a contract's limited tries (Contract.ts:63 vs getMaxNumTries at
// Contract.ts:106) and a contract that runs out is destroyed along with its
// reward, so `throw` — which ctauto.js:90-94 counts as skipped, leaving the
// contract intact for later — is strictly better than a plausible guess.

/* --- shared helpers for the Compression family -------------------------- */

// Port of comprLZDecode, Compression.ts:323-364. Returns null on invalid input,
// exactly as the game does; the game's getAnswer maps that to "".
function comprLZDecode(compr) {
  let plain = ''

  for (let i = 0; i < compr.length; ) {
    const literalLength = compr.charCodeAt(i) - 0x30

    if (literalLength < 0 || literalLength > 9 || i + 1 + literalLength > compr.length) {
      return null
    }

    plain += compr.substring(i + 1, i + 1 + literalLength)
    i += 1 + literalLength

    if (i >= compr.length) {
      break
    }
    const backrefLength = compr.charCodeAt(i) - 0x30

    if (backrefLength < 0 || backrefLength > 9) {
      return null
    } else if (backrefLength === 0) {
      ++i
    } else {
      if (i + 1 >= compr.length) {
        return null
      }

      const backrefOffset = compr.charCodeAt(i + 1) - 0x30
      if ((backrefLength > 0 && (backrefOffset < 1 || backrefOffset > 9)) || backrefOffset > plain.length) {
        return null
      }

      for (let j = 0; j < backrefLength; ++j) {
        plain += plain[plain.length - backrefOffset]
      }

      i += 2
    }
  }

  return plain
}

// Port of comprLZEncode, Compression.ts:202-320 — a shortest-encoding DP over
// (chunk kind, pending chunk length), where kind 0 is a literal and kind k>0 is
// a backreference of offset k.
//
// ONE DELIBERATE DIFFERENCE from the game: the game's `set` breaks ties between
// equal-length candidates at random (Compression.ts:213-217), purely so that it
// generates a wider variety of inputs for Compression II. That randomness
// cannot change any state's *length*, only which equally-short string is kept,
// so taking the first is safe — and the validator (Compression.ts:158) asks
// only `answer.length <= encoded.length && comprLZDecode(answer) === plain`,
// never for a specific string.
function comprLZEncode(plain) {
  let curState = Array.from({ length: 10 }, () => new Array(10).fill(null))
  let newState = Array.from({ length: 10 }, () => new Array(10).fill(null))

  function set(state, i, j, str) {
    const current = state[i][j]
    if (current === null || str.length < current.length) {
      state[i][j] = str
    }
  }

  // initial state is a literal of length 1
  curState[0][1] = ''

  for (let i = 1; i < plain.length; ++i) {
    for (const row of newState) {
      row.fill(null)
    }
    const c = plain[i]

    // handle literals
    for (let length = 1; length <= 9; ++length) {
      const string = curState[0][length]
      if (string === null) {
        continue
      }

      if (length < 9) {
        // extend current literal
        set(newState, 0, length + 1, string)
      } else {
        // start new literal
        set(newState, 0, 1, string + '9' + plain.substring(i - 9, i) + '0')
      }

      for (let offset = 1; offset <= Math.min(9, i); ++offset) {
        if (plain[i - offset] === c) {
          // start new backreference
          set(newState, offset, 1, string + String(length) + plain.substring(i - length, i))
        }
      }
    }

    // handle backreferences
    for (let offset = 1; offset <= 9; ++offset) {
      for (let length = 1; length <= 9; ++length) {
        const string = curState[offset][length]
        if (string === null) {
          continue
        }

        if (plain[i - offset] === c) {
          if (length < 9) {
            // extend current backreference
            set(newState, offset, length + 1, string)
          } else {
            // start new backreference
            set(newState, offset, 1, string + '9' + String(offset) + '0')
          }
        }

        // start new literal
        set(newState, 0, 1, string + String(length) + String(offset))

        // end current backreference and start new backreference
        for (let newOffset = 1; newOffset <= Math.min(9, i); ++newOffset) {
          if (plain[i - newOffset] === c) {
            set(newState, newOffset, 1, string + String(length) + String(offset) + '0')
          }
        }
      }
    }

    const tmp = newState
    newState = curState
    curState = tmp
  }

  let result = null

  for (let len = 1; len <= 9; ++len) {
    let string = curState[0][len]
    if (string === null) {
      continue
    }
    string += String(len) + plain.substring(plain.length - len, plain.length)
    if (result === null || string.length < result.length) {
      result = string
    }
  }

  for (let offset = 1; offset <= 9; ++offset) {
    for (let len = 1; len <= 9; ++len) {
      let string = curState[offset][len]
      if (string === null) {
        continue
      }
      string += String(len) + String(offset)
      if (result === null || string.length < result.length) {
        result = string
      }
    }
  }

  // `result === null` rather than `result ?? ''`: only an empty plaintext can
  // produce it, and an empty string is a legitimate value elsewhere in this
  // file. Falsy-checks turning a real "" or 0 into "no answer" is a mistake
  // this repo has made more than once.
  return result === null ? '' : result
}

/* --- shared helpers for the HammingCodes family ------------------------- */

// Port of HammingEncode, HammingCode.ts:100-152. Note this is NOT
// HammingEncodeProperly (HammingCode.ts:154-218): that second function only
// GENERATES the strings for the decode contract and pads to a full power-of-two
// block. The encode contract is checked against this one (HammingCode.ts:39-44),
// which emits exactly as many bits as the data needs.
function hammingEncode(data) {
  const enc = [0]
  const dataBits = data
    .toString(2)
    .split('')
    .reverse()
    .map((value) => parseInt(value))

  let k = dataBits.length

  /* NOTE: writing the data like this flips the endianness; the game does the
   * same and the answer key is the game's output, not the textbook's. */
  for (let i = 1; k > 0; i++) {
    if ((i & (i - 1)) !== 0) {
      enc[i] = dataBits[--k]
    } else {
      enc[i] = 0
    }
  }

  let parityNumber = 0

  /* Figure out the subsection parities */
  for (let i = 0; i < enc.length; i++) {
    if (enc[i]) {
      parityNumber ^= i
    }
  }

  const parityArray = parityNumber
    .toString(2)
    .split('')
    .reverse()
    .map((value) => parseInt(value))

  /* Set the parity bits accordingly */
  for (let i = 0; i < parityArray.length; i++) {
    enc[2 ** i] = parityArray[i] ? 1 : 0
  }

  parityNumber = 0
  /* Figure out the overall parity for the entire block */
  for (let i = 0; i < enc.length; i++) {
    if (enc[i]) {
      parityNumber++
    }
  }

  /* Finally set the overall parity bit */
  enc[0] = parityNumber % 2 === 0 ? 0 : 1

  return enc.join('')
}

// Port of HammingDecode, HammingCode.ts:220-257. ~55% of generated instances
// carry exactly one flipped bit (HammingCode.ts:77,83-86); the XOR of the set
// indices spells out which one, and index 0 — the overall parity bit — is
// deliberately ignored when reading the message back out.
//
// The result goes through the game's own `parseInt(ans, 2)`, which is lossy
// above 2^53 and the inputs reach 2^57 (HammingCode.ts:79). That is fine and
// must be preserved: the validator compares against the identically-lossy
// value, so any "improvement" here (BigInt, say) would make correct answers
// compare unequal.
function hammingDecode(data) {
  let err = 0
  const bits = []

  const bitStringArray = data.split('')
  for (let i = 0; i < bitStringArray.length; ++i) {
    const bit = parseInt(bitStringArray[i])
    bits[i] = bit

    if (bit) {
      err ^= +i
    }
  }

  /* If err != 0 then it spells out the index of the bit that was flipped */
  if (err) {
    /* Flip to correct */
    bits[err] = bits[err] ? 0 : 1
  }

  let ans = ''

  for (let i = 1; i < bits.length; i++) {
    /* i is not a power of two so it's not a parity bit */
    if ((i & (i - 1)) !== 0) {
      ans += bits[i]
    }
  }

  return parseInt(ans, 2)
}

codingContractTypesMetadata.push(
  {
    // Port of ArrayJumpingGame.ts:91-111. The validator is
    // `getAnswer(data) === answer` (ArrayJumpingGame.ts:113-115), so this is
    // the game's greedy verbatim rather than a textbook minimum-jumps BFS —
    // and it answers 0, not Infinity, for an unreachable last index, which is
    // also the documented convention (ArrayJumpingGame.ts:71).
    name: 'Array Jumping Game II',
    // data = number[]
    solver: function (data) {
      const n = data.length
      let reach = 0
      let jumps = 0
      let lastJump = -1
      while (reach < n - 1) {
        let jumpedFrom = -1
        for (let i = reach; i > lastJump; i--) {
          if (i + data[i] > reach) {
            reach = i + data[i]
            jumpedFrom = i
          }
        }
        if (jumpedFrom === -1) {
          jumps = 0
          break
        }
        lastJump = jumpedFrom
        jumps++
      }
      return jumps
    },
    difficulty: 3,
  },
  {
    // Port of Compression.ts:53-68. Checked by exact string equality
    // (Compression.ts:69-71), so the run-splitting has to match the game's:
    // a run is closed when it reaches 9, never longer, so 19 z's encode as
    // "9z9z1z" and not "9z8z2z" even though both are the same length.
    name: 'Compression I: RLE Compression',
    // data = string
    solver: function (data) {
      if (data.length === 0) return ''

      let out = ''
      let count = 1
      for (let i = 1; i < data.length; i++) {
        if (count < 9 && data[i] === data[i - 1]) {
          count++
          continue
        }
        out += count + data[i - 1]
        count = 1
      }
      out += count + data[data.length - 1]
      return out
    },
    difficulty: 2,
  },
  {
    // Compression.ts:104-106. Exact string equality against the game's own
    // decoder, so this is that decoder. Generated inputs are always valid, so
    // the null branch should never fire — it throws rather than submitting ""
    // so that an unexpected input skips the contract instead of destroying it.
    name: 'Compression II: LZ Decompression',
    // data = string (LZ-encoded)
    solver: function (data) {
      const plain = comprLZDecode(data)
      if (plain === null) {
        throw new Error(`Compression II: input is not valid LZ (${data})`)
      }
      return plain
    },
    difficulty: 4,
  },
  {
    // Compression.ts:148-159. The ONLY contract in this file whose validator
    // does not compare to a fixed string: it accepts any encoding that is no
    // longer than the game's optimum and decodes back to the plaintext. The
    // shortest-encoding DP is ported so "no longer than" is guaranteed by
    // construction rather than hoped for — a hand-rolled greedy would be right
    // most of the time, and this contract is difficulty 10, i.e. the most
    // valuable one here.
    name: 'Compression III: LZ Compression',
    // data = string (plaintext)
    solver: function (data) {
      const encoded = comprLZEncode(data)
      // Self-check before answering, because this is the one place where being
      // subtly wrong is possible. Costs microseconds; the alternative is a
      // destroyed difficulty-10 contract.
      if (comprLZDecode(encoded) !== data) {
        throw new Error('Compression III: encoding does not round-trip, refusing to answer')
      }
      return encoded
    },
    difficulty: 10,
  },
  {
    // Port of Encryption.ts:228-239. `2 * 65` is the game's, not a typo: it
    // subtracts 'A' from the plaintext char and again from the key char.
    //
    // THE NAME CONTAINS U+00E8 (è, precomposed — NFC, not 'e' + combining
    // grave). Dispatch in findAnswer() is an exact string match on
    // contract.type, so a decomposed or ASCII spelling makes this solver
    // silently never fire, which looks identical to having no solver at all.
    // Enums.ts:27 is the source of truth; ctsolvers.test.mjs check CT2 asserts
    // this file's name set equals the game's, in both directions.
    name: 'Encryption II: Vigenère Cipher',
    // data = [plaintext, keyword]
    solver: function (data) {
      return [...data[0]]
        .map((a, i) =>
          a === ' '
            ? a
            : String.fromCharCode(((a.charCodeAt(0) - 2 * 65 + data[1].charCodeAt(i % data[1].length)) % 26) + 65),
        )
        .join('')
    },
    difficulty: 2,
  },
  {
    // HammingCode.ts:89-93. Answer is a NUMBER, not a string: validateAnswer
    // at HammingCode.ts:96 demands `typeof ans === "number"`. A string would
    // survive (convertAnswer parseInts it, HammingCode.ts:95) but only by
    // accident of the values staying under 1e21, so return the number.
    name: 'HammingCodes: Encoded Binary to Integer',
    // data = string of '0'/'1', ~55% of which have one flipped bit
    solver: function (data) {
      return hammingDecode(data)
    },
    difficulty: 9,
  },
  {
    // HammingCode.ts:39-44. Answer is a STRING of '0'/'1' (HammingCode.ts:46).
    // The opposite direction from the above and a genuinely different problem:
    // no error to correct, but the parity bits are written least-significant
    // first while the data bits are written most-significant first.
    name: 'HammingCodes: Integer to Encoded Binary',
    // data = number
    solver: function (data) {
      return hammingEncode(data)
    },
    difficulty: 6,
  },
  {
    // Port of LargestRectangle.ts:72-117. The validator (LargestRectangle.ts:
    // 118-153) checks the submitted rectangle is 1-free AND has the same AREA
    // as the game's answer — corners need not match — but porting getAnswer
    // gives both for free. Answer is [[r1,c1],[r2,c2]] as real arrays of
    // numbers (validateAnswer, LargestRectangle.ts:161).
    name: 'Largest Rectangle in a Matrix',
    // data = (0|1)[][]
    solver: function (data) {
      const histograms = Array.from({ length: data.length }, () => new Array(data[0].length).fill(0))
      for (let i = 0; i < data[0].length; i++) {
        let count = 0
        for (let j = 0; j < data.length; j++) {
          if (data[j][i] === 0) {
            count++
          } else {
            count = 0
          }
          histograms[j][i] = count
        }
      }
      let maxArea = 0
      let maxL = 0
      let maxR = 0
      let maxU = 0
      let maxD = 0
      for (let i = 0; i < histograms.length; i++) {
        const row = histograms[i]
        for (let j = 0; j < row.length; j++) {
          if (row[j] === 0) continue
          let left = j
          let right = j
          // Out-of-bounds reads are `undefined`, and every comparison with a
          // number is false, which is how these loops terminate. The game
          // relies on exactly this (LargestRectangle.ts:96-97) — do not
          // "fix" it into an explicit bounds check with >= semantics.
          while (row[left - 1] >= row[j]) {
            left--
          }
          while (row[right + 1] >= row[j]) {
            right++
          }
          if ((right - left + 1) * row[j] > maxArea) {
            maxArea = (right - left + 1) * row[j]
            maxL = left
            maxR = right
            maxU = i - row[j] + 1
            maxD = i
          }
        }
      }
      if (maxArea === 0) {
        // Only reachable on an all-1s grid, which generate() explicitly loops
        // to avoid (LargestRectangle.ts:50-68). [[0,0],[0,0]] would name a
        // blocked cell and be rejected, so refuse instead.
        throw new Error('Largest Rectangle: no 1-free cell in the matrix')
      }
      return [
        [maxU, maxL],
        [maxD, maxR],
      ]
    },
    difficulty: 6,
  },
  {
    // Proper2ColoringOfAGraph.ts:247-288. getAnswer() returns null here, so
    // there is no answer key to port: the validator re-derives bipartiteness
    // itself and then accepts ANY coloring with no monochromatic edge, or the
    // empty array if the graph is not 2-colorable. Both outcomes are real:
    // generate() builds a bipartite graph and then adds one extra edge with no
    // regard to the partition (Proper2ColoringOfAGraph.ts:212-218), which makes
    // an odd cycle a good fraction of the time.
    name: 'Proper 2-Coloring of a Graph',
    // data = [numVertices, [u, v][]]
    solver: function (data) {
      const n = data[0]
      const edges = data[1]
      const adj = []
      for (let i = 0; i < n; i++) adj.push([])
      for (const e of edges) {
        const a = e[0]
        const b = e[1]
        if (!(a >= 0 && a < n && b >= 0 && b < n)) {
          throw new Error(`Proper 2-Coloring: edge [${a},${b}] outside 0..${n - 1}`)
        }
        adj[a].push(b)
        adj[b].push(a)
      }

      const colors = new Array(n).fill(-1)
      for (let start = 0; start < n; start++) {
        if (colors[start] !== -1) continue
        colors[start] = 0
        const frontier = [start]
        for (let qi = 0; qi < frontier.length; qi++) {
          const v = frontier[qi]
          for (const u of adj[v]) {
            if (colors[u] === -1) {
              colors[u] = 1 - colors[v]
              frontier.push(u)
            } else if (colors[u] === colors[v]) {
              // Not 2-colorable. The empty array IS the answer here, and it
              // must reach ns.codingcontract.attempt as an array — findAnswer
              // returning [] is not "no answer", and ctauto.js:95 only skips
              // on undefined/null, which is why that check is written the way
              // it is rather than as a truthiness test.
              return []
            }
          }
        }
      }
      return colors
    },
    difficulty: 7,
  },
  {
    // ShortestPathInAGrid.ts:59-129. getAnswer() returns null: the validator
    // BFSs the grid itself and accepts any UDLR string that is no longer than
    // the true shortest distance, stays on 0-cells, and lands on the
    // bottom-right. Roughly 22% of generated grids have no path at all
    // (ShortestPathInAGrid.ts:48), and for those the answer is the EMPTY
    // STRING — which must not be confused with "no answer".
    name: 'Shortest Path in a Grid',
    // data = (0|1)[][]
    solver: function (data) {
      const height = data.length
      const width = data[0].length
      const dstY = height - 1
      const dstX = width - 1

      if (data[dstY][dstX] !== 0 || data[0][0] !== 0) return ''

      // BFS outwards from the DESTINATION, so the distance field can be walked
      // downhill from the start to produce a path without storing parents.
      const dist = []
      for (let y = 0; y < height; y++) dist.push(new Array(width).fill(-1))
      dist[dstY][dstX] = 0
      const queue = [[dstY, dstX]]
      for (let qi = 0; qi < queue.length; qi++) {
        const y = queue[qi][0]
        const x = queue[qi][1]
        const d = dist[y][x] + 1
        const steps = [
          [y - 1, x],
          [y + 1, x],
          [y, x - 1],
          [y, x + 1],
        ]
        for (const s of steps) {
          const ny = s[0]
          const nx = s[1]
          if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue
          if (data[ny][nx] !== 0) continue
          if (dist[ny][nx] !== -1) continue
          dist[ny][nx] = d
          queue.push([ny, nx])
        }
      }

      if (dist[0][0] === -1) return ''

      let y = 0
      let x = 0
      let path = ''
      while (y !== dstY || x !== dstX) {
        const want = dist[y][x] - 1
        if (y > 0 && dist[y - 1][x] === want) {
          y--
          path += 'U'
        } else if (y < height - 1 && dist[y + 1][x] === want) {
          y++
          path += 'D'
        } else if (x > 0 && dist[y][x - 1] === want) {
          x--
          path += 'L'
        } else if (x < width - 1 && dist[y][x + 1] === want) {
          x++
          path += 'R'
        } else {
          // Unreachable: any cell with distance k was discovered from a
          // neighbour at k-1, so a downhill step always exists. Throwing keeps
          // the contract alive if that reasoning is ever wrong; returning ''
          // here would be a WRONG answer, not an abstention, because the
          // validator would find the path finite and the endpoint not reached.
          throw new Error('Shortest Path: distance field has no downhill step')
        }
      }
      return path
    },
    difficulty: 7,
  },
  {
    // SquareRoot.ts:174-178. Unusual in three ways. (1) The state stored in the
    // save is [root, offset] as strings and the DATA handed to Netscript is a
    // ~200-digit BigInt built by getData (SquareRoot.ts:167-170) — so
    // ns.codingcontract.getData() really does return a bigint. (2) The answer
    // must round to the NEAREST integer, not floor: the generator picks the
    // offset from [1-n, n] specifically to test both edges (SquareRoot.ts:
    // 157-163). (3) The comparison is `state[0] === answer.toString()`, so a
    // decimal string is returned — the problem text asks for exactly that, and
    // it is also what convertAnswer (BigInt(ans), SquareRoot.ts:177) expects.
    name: 'Square Root',
    // data = bigint
    solver: function (data) {
      const ZERO = BigInt(0)
      const ONE = BigInt(1)
      const TWO = BigInt(2)
      const n = typeof data === 'bigint' ? data : BigInt(data)
      if (n < ZERO) throw new Error('Square Root: negative input')
      if (n < TWO) return n.toString()

      // Newton's method for floor(sqrt(n)). The seed 2^ceil(bits/2) is >=
      // sqrt(n) for every n < 2^bits, which is what makes the iteration
      // monotonically decreasing and the stopping test exact.
      let x = ONE << BigInt(Math.ceil(n.toString(2).length / 2))
      let y = (x + n / x) / TWO
      while (y < x) {
        x = y
        y = (x + n / x) / TWO
      }

      // Round to nearest: sqrt(n) >= x + 1/2  <=>  n >= x^2 + x + 1/4, and both
      // sides are integers, so  <=>  n - x^2 > x.
      return (n - x * x > x ? x + ONE : x).toString()
    },
    difficulty: 5,
  },
  {
    // Port of TotalPrimesInRange.ts:204-261 — a segmented sieve, because the
    // range is up to 1e6 wide starting anywhere below 5e6
    // (TotalPrimesInRange.ts:200-202) and the generator's comment says the
    // sizes were chosen to make a precomputed table impractical. Answer is a
    // number (TotalPrimesInRange.ts:266).
    name: 'Total Number of Primes',
    // data = [low, high]
    solver: function (data) {
      function simpleSieve(max) {
        const primes = []
        const arr = new Array(max)
        for (let i = 2; i * i <= max; i++) {
          if (!arr[i]) {
            for (let p = i * i; p <= max; p += i) {
              arr[p] = 1
            }
          }
        }
        for (let i = 2; i <= max; i++) {
          if (!arr[i]) {
            primes.push(i)
          }
        }
        return primes
      }

      let low = data[0]
      const high = data[1]
      // 0 and 1 are not prime and are not covered by the segmented sieve's
      // marking, so they are excluded by moving the floor up rather than by
      // subtracting afterwards — which is what the game does.
      if (low < 2) {
        low = 2
      }
      let count = 0
      const arr = new Array(high - low + 1)
      const checks = simpleSieve(Math.ceil(Math.sqrt(high)))
      for (const i of checks) {
        const lim = Math.max(i, Math.ceil(low / i)) * i
        for (let j = lim; j <= high; j += i) {
          arr[j - low] = 1
        }
      }
      for (let a = 0; a <= high - low; a++) {
        if (!arr[a]) {
          ++count
        }
      }
      return count
    },
    difficulty: 2,
  },
  {
    // Port of TotalWaysToSum.ts:72-85. The coin-change count: iterate the coin
    // set in the outer loop so each multiset is counted once. Distinct from
    // 'Total Ways to Sum' above, which sums over 1..n-1 and excludes n itself.
    // The answer can exceed 2^53 for large n with a small coin set, but both
    // sides accumulate in the same order with the same doubles, so the
    // comparison is still exact.
    name: 'Total Ways to Sum II',
    // data = [n, coins[]]
    solver: function (data) {
      const n = data[0]
      const s = data[1]
      const ways = [1]
      ways.length = n + 1
      ways.fill(0, 1)
      for (let i = 0; i < s.length; i++) {
        for (let j = s[i]; j <= n; j++) {
          ways[j] += ways[j - s[i]]
        }
      }
      return ways[n]
    },
    difficulty: 2,
  },
)

/** Look up and run the solver for a scanned contract. Returns undefined if unknown. */
export function findAnswer(contract) {
  const meta = codingContractTypesMetadata.find((m) => m.name === contract.type)
  return meta ? meta.solver(contract.data) : undefined
}
