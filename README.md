NavAI : AI-Powered Accessible Voice Web Navigator

"Speak to navigate. Any website. No setup required."

NavAI is a Chrome browser extension that enables visually impaired users to navigate any website using natural voice commands. Speak your intent, and NavAI finds the right element, scrolls to it, highlights it, and reads back a confirmation on any website, without requiring any changes to the site itself.

PURPOSE:
NavAI addresses a critical accessibility gap: while assistive technologies 
like screen readers exist, they are complex to learn, struggle with modern 
JavaScript-heavy web applications, and require significant setup. NavAI 
provides an intuitive, voice-first alternative that works universally 
on e-commerce sites, news portals, government services, educational platforms, 
and any other web destination without any cooperation from the website owner.

FUNCTIONALITY:
When a user speaks a command, NavAI's content script (injected into the active 
page via Chrome's Manifest V3 extension API) captures the voice input using 
the browser's native Web Speech API. It then builds a minified snapshot of 
the page's interactive DOM elements anchors, buttons, inputs, headings, 
and landmark regions assigning each a unique identifier. This snapshot is 
sent to the FastAPI backend via the extension's background service worker 
(which bypasses the host page's Content Security Policy, a common blocker 
for content script network calls).

The backend passes the user's command and DOM snapshot to a LangChain chain 
powered by Gemini 2.5 Flash, which performs semantic intent-to-element 
matching. If matched with high confidence, it returns the element's ID and 
a spoken confirmation. If not, it signals the frontend to capture a viewport 
screenshot, which is then analyzed by Gemini 2.5 Flash's vision capabilities 
to determine precise pixel coordinates of the target region.