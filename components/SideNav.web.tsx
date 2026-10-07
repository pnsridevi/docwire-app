import React from 'react';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { tabIcon } from './navIcons';
import { NavTab, makeActiveTab, splitActiveTab } from './navTypes';

// Web-only rendering of SideNav. Metro picks this file automatically for
// any `import ... from './SideNav'` on web builds (SideNav.tsx handles
// native) — same import path, no branching at the call site.
//
// This exists specifically for real CSS :hover, which React Native (and
// RN Web's View/TouchableOpacity) has no way to express — only imperative
// onMouseEnter/Leave state juggling. The demo's actual rule is
// `.nav-item:hover{background:rgba(255,255,255,0.25)}` (a lighter overlay
// than the 0.4 active state); this file writes that rule once via a
// plain <style> tag rather than approximating it with JS-driven state.
//
// Deliberately uses raw <div>/<span> instead of View/Text — this file
// only ever compiles for the web (react-dom), so plain DOM elements are
// safe here in a way they wouldn't be in a shared .tsx file.
//
// `tabs` is NavTab[] (this session's change) — a tab with `children`
// renders as a section header plus an indented, always-expanded nested
// list. `active` is a plain label or a composite 'Parent::Child' key —
// see navTypes.ts.

let styleInjected = false;
function ensureHoverStyle() {
  if (styleInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.setAttribute('data-docwire', 'sidenav-hover');
  style.textContent = `
    .dw-nav-item { cursor: pointer; }
    .dw-nav-item:hover { background: rgba(255,255,255,0.25); }
    .dw-nav-item.dw-nav-item-active:hover { background: rgba(255,255,255,0.4); }
  `;
  document.head.appendChild(style);
  styleInjected = true;
}

const FONT_STACK = 'Arial, Helvetica, "Segoe UI", Roboto, sans-serif'; // matches DocWire_demo_V1.html's body rule exactly

const sideLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: colors.sidebarLabel,
  padding: '6px 20px 8px',
  fontFamily: FONT_STACK,
};

function itemStyle(isActive: boolean, nested?: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: nested ? '7px 20px 7px 46px' : '9px 20px',
    fontSize: nested ? 12.5 : 13.5,
    fontFamily: FONT_STACK,
    fontWeight: isActive ? 700 : 500,
    color: isActive ? colors.sidebarTextActive : colors.sidebarText,
    borderLeft: `3px solid ${isActive ? colors.sidebarTextActive : 'transparent'}`,
    background: isActive ? colors.sidebarActiveOverlay : 'transparent',
  };
}

export function SideNav({
  tabs,
  active,
  onChange,
}: {
  tabs: NavTab[];
  active: string;
  onChange: (tab: string) => void;
}) {
  ensureHoverStyle();
  const { parent: activeParent, child: activeChild } = splitActiveTab(active);

  return (
    <div
      style={{
        width: 212,
        background: colors.sidebar,
        paddingTop: 18,
        paddingBottom: 18,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      <div style={sideLabelStyle}>Workspace</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {tabs.map((tab) => {
          if (!tab.children || tab.children.length === 0) {
            const isActive = tab.label === activeParent && !activeChild;
            return (
              <div
                key={tab.label}
                className={`dw-nav-item${isActive ? ' dw-nav-item-active' : ''}`}
                onClick={() => onChange(tab.label)}
                style={itemStyle(isActive)}
              >
                <Feather name={tabIcon(tab.label)} size={16} color={isActive ? colors.sidebarTextActive : colors.sidebarText} />
                <span>{tab.label}</span>
              </div>
            );
          }

          // Section header — clicking it shows the parent's own default
          // view (no child selected), same as any other top-level tab.
          // Previously this jumped straight to the first child instead,
          // which broke once Users got a real default view (the
          // overview) plus just one child ('Add') — clicking "Users"
          // always landed on Add and the overview was only reachable via
          // Add's own "back" button.
          const isParentActive = tab.label === activeParent;
          return (
            <div key={tab.label}>
              <div
                className={`dw-nav-item${isParentActive && !activeChild ? ' dw-nav-item-active' : ''}`}
                onClick={() => onChange(tab.label)}
                style={itemStyle(isParentActive && !activeChild)}
              >
                <Feather name={tabIcon(tab.label)} size={16} color={isParentActive ? colors.sidebarTextActive : colors.sidebarText} />
                <span>{tab.label}</span>
              </div>
              {tab.children.map((child) => {
                const key = makeActiveTab(tab.label, child);
                const isActive = isParentActive && activeChild === child;
                return (
                  <div
                    key={key}
                    className={`dw-nav-item${isActive ? ' dw-nav-item-active' : ''}`}
                    onClick={() => onChange(key)}
                    style={itemStyle(isActive, true)}
                  >
                    <Feather name={tabIcon(child)} size={13} color={isActive ? colors.sidebarTextActive : colors.sidebarText} />
                    <span>{child}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {/* Session/Log out used to live here. Removed rather than continuing
          to fight height/overflow edge cases: logout already exists via
          the Topbar avatar menu (top-right, both platforms) and works
          correctly there. Duplicating it here added a whole category of
          layout bug for no functional gain — one working logout path
          beats two, one of which kept breaking. */}
    </div>
  );
}