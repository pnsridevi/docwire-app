// Web-only global styles, injected once at app startup. Two things this
// fixes that no per-component style can:
//
// 1. Font family. The demo's body rule is:
//      font-family: Arial, Helvetica, "Segoe UI", Roboto, sans-serif;
//    React Native Text components pick up a reasonable default font via
//    react-native-web's own reset, but SideNav.web.tsx deliberately uses
//    raw <div>/<span> (needed for real CSS :hover) — those aren't RN Text,
//    so they don't get that treatment and fall back to the browser's
//    generic default (a serif, on most browsers), which is what produced
//    the mismatch against the demo. Setting it on <body> fixes every plain
//    HTML element at once via normal CSS inheritance, sidebar included.
//
// 2. Height chain. html/body/#root need an explicit height for percentage
//    heights (SideNav's height:'100%') to resolve against reliably. Metro's
//    default web scaffold doesn't always set this, which can leave content
//    near the bottom of a tall page inaccessible with no scrollbar to
//    reach it.
let injected = false;

export function ensureGlobalWebStyles() {
  if (injected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.setAttribute('data-docwire', 'global-web');
  style.textContent = `
    html, body, #root { height: 100%; width: 100%; margin: 0; }
    body { font-family: Arial, Helvetica, "Segoe UI", Roboto, sans-serif; }
  `;
  document.head.appendChild(style);
  injected = true;
}