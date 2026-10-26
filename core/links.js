// Where people get Morse, for the pages that send them there: the welcome
// page and the popup in Chrome ("Download Morse"). The site's Install section
// picks the right download for the computer (site/config.js LINKS.desktop),
// so this is the one address to keep. It is package.json's homepage
// (tests/seo.test.js checks that they agree).

export const SITE = "https://getmorse.vercel.app/";
export const DOWNLOAD = `${SITE}#install`;
