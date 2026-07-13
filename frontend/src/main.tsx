import React from 'react'
import {createRoot} from 'react-dom/client'
import './style.css'
import App from './App'
import {ClipboardSetText} from '../wailsjs/runtime/runtime'

// WKWebView clipboard fix (macOS, Wails v2 + v3 both render in Apple's WKWebView).
// navigator.clipboard.writeText() only succeeds with document focus AND live
// transient user activation from the click. WKWebView drops that state easily —
// any `await` before the write consumes the activation; native menu clicks,
// window focus changes, and DevTools also kill it — after which writeText rejects
// with a SILENT NotAllowedError. Copy buttons then look fine but do nothing, and
// a reload doesn't fix it. (A Jan-2025 WebKit change also made the
// document.execCommand('copy') fallback unreliable.) Route text copies through
// Go/NSPasteboard (ClipboardSetText → window.runtime.ClipboardSetText), which has
// no focus/activation gate. Patched ONCE here, before first render, so every copy
// button — including ones inside third-party components — transparently reroutes.
// Only writeText is overridden: paste handlers (e.clipboardData),
// navigator.clipboard.read(), and navigator.clipboard.write() (rich/HTML) are
// untouched and still go through WebKit.
if (typeof window !== 'undefined' && (window as any).runtime?.ClipboardSetText && navigator.clipboard) {
    Object.defineProperty(navigator.clipboard, 'writeText', {
        value: (text: string) => ClipboardSetText(text),
        configurable: true,
    })
}

const container = document.getElementById('root')

const root = createRoot(container!)

root.render(
    <React.StrictMode>
        <App/>
    </React.StrictMode>
)
