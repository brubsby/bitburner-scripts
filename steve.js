//https://www.sltinfo.com/syllables-and-clusters/

const possible_name_vowels = ["e","e","e","e","e","e","ee","ee","ee","ea"];
const possible_name_endings = ["ve"];

const one_consonant_starts = [
  "",
  "m", "mh",
  "n", "gn", "kn", "mn", "pn",
  "p",
  "b", "bh",
  "t", "pt",
  "d", "dh",
  "c", "k", "kh", "q",
  "g", "gh",
  "s", "c", "ps", "sc",
  "z", "cz", "ts", "tz", "x",
  "sh", "sch",
  "zh",
  "f", "ph",
  "v",
  "th", "chth", "phth",
  "y",
  "h",
  "rh", "wr",
  "l",
  "w", "ou",
  "wh", "ch", "cz", "tch", "tsh", "tzsch",
  "j",
  "x",
];

const two_consonant_clusters = [
  "sm",
  "sn",
  "st",
  "sw",
  "sk",
  "sl",
  "sp",
  "sf",
  "θw",
  "dw",
  "tw",
  "θr",
  "dr",
  "tr",
  "kw",
  "kr",
  "kl",
  "pr",
  "fr",
  "br",
  "gr",
  "pl",
  "fl",
  "bl",
  "gl",
  "ʃr",
];

const three_consonant_clusters = [
  "spl",
  "spr",
  "str",
  "sfr",
  "skr",
  "skw",
  "sqw",
];

const consonant_substitutions = {
  "θ": ["th"],
  "f": ["f", "ph"],
  "ʃ": ["sh", "sch"],
}

//https://stackoverflow.com/a/57015870/3586848
const combine = ([head, ...[headTail, ...tailTail]]) => {
  if (!headTail) return head
  const combined = headTail.reduce((acc, x) =>
    acc.concat(head.map(h => `${h}${x}`))
  , [])
  return combine([combined, ...tailTail]);
};

const substitute_consonants = (clusters, substitutions) =>
  clusters.map(cluster =>
    combine(cluster.split('').map(letter =>
      substitutions[letter] ? substitutions[letter] : [letter])))
    .flat();

const two_consonant_clusters_with_substitutions =
  substitute_consonants(two_consonant_clusters, consonant_substitutions);

const three_consonant_clusters_with_substitutions =
  substitute_consonants(three_consonant_clusters, consonant_substitutions);

const starts = one_consonant_starts
  .concat(two_consonant_clusters_with_substitutions)
  .concat(three_consonant_clusters_with_substitutions);

const sample = (array) => array[Math.floor(Math.random()*array.length)];

export const steve = () =>
  `${sample(starts)}${sample(possible_name_vowels)}${sample(possible_name_endings)}`;

export async function main(ns) {
  let flags = ns.flags([
    ["n", 0]
  ])
  let n = flags.n || flags._[0] || 1;
  if (n == 1) ns.tprint(steve());
  else ns.tprint(JSON.stringify([...Array(n)].map(n=>steve())));
}
