NavAI — AI-Powered Accessible Voice Web Navigator

"Speak to navigate. Any website. No setup required."

NavAI is a Chrome browser extension that enables visually impaired users to navigate any website using natural voice commands. Speak your intent, and NavAI finds the right element, scrolls to it, highlights it, and reads back a confirmation — on any website, without requiring any changes to the site itself.

Built for Bharat Academix CodeQuest 2026 — Round 2 by Team Neutral Tech.

How It Works :

User speaks command
        ↓
content.js captures voice (Web Speech API)
builds lightweight DOM snapshot
        ↓
background.js proxies request to backend
(bypasses host page Content Security Policy)
        ↓
FastAPI backend receives command + DOM snapshot
        ↓
LangChain + Gemini 2.5 Flash
performs semantic intent-to-element matching
        ↓
        ┌──────────────────────┬─────────────────────────┐
        │                      │                         │
   Match found            No confident match            
   (SCROLL_TO)            (CAPTURE_SCREEN)              
        │                      │                         
        │         background.js captures screenshot      
        │                      ↓                         
        │         Gemini 2.5 Flash (vision mode)         
        │         returns pixel coordinates              
        │                      │                         
        └──────────┬───────────┘                         
                   ↓
    Scroll + highlight target element
    Speak confirmation via TTS
    Save to chrome.storage (popup history)