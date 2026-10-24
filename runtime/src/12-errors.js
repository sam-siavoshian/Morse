// Plain words for raw errors. Messages Morse writes itself already read well
// and pass through; browser, network and JavaScript errors become one short
// sentence saying what went wrong and the one thing to try. The raw text is
// still available (the bar puts it in a tooltip).
const PLAIN_ERRORS = [
  [/failed to fetch|fetch failed|connection error|networkerror|network request failed|load failed|ERR_(CONNECTION|NAME_NOT_RESOLVED|INTERNET|NETWORK)|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/i,
    "Couldn't reach the model. Check your connection and try again."],
  [/could not establish connection|receiving end does not exist|extension context invalidated|message port closed|host unavailable/i,
    "Morse lost touch with this page. Reload the page and try again."],
  [/timed? ?out|timeout|deadline/i, "The model took too long. Try a smaller change."],
  [/^(aborted|AbortError.*|The (user|operation) aborted.*|signal is aborted.*)$/i, "Stopped. Nothing was changed."],
  [/^no result$/i, "The change didn't run on this page. Reload the page and try again."],
  [/^(Uncaught )?(\w*Error: )?.*(is not defined|is not a function|Cannot read propert|Cannot set propert|is not iterable|Unexpected token|Unexpected end of input|Invalid or unexpected token|is not a valid selector|Failed to execute)/,
    "The new code had a bug. Try describing it another way."],
  [/^Unexpected (token|end of JSON)|JSON\.parse|is not valid JSON/i, "Morse got an answer it couldn't read. Try again."],
  [/quota|QuotaExceeded/i, "Morse is out of storage space. Delete some mods and try again."],
];
function plainError(err) {
  const raw = String((err && err.message) || err || "").trim();
  if (!raw) return "Something went wrong. Try again.";
  for (const [re, text] of PLAIN_ERRORS) if (re.test(raw)) return text;
  return raw;
}
