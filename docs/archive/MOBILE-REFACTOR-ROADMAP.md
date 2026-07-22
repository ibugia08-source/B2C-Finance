# Mobile Refactor — Roadmap Consolidado

**Status:** 📋 Pronto para Fase 6  
**Auditoria:** Completa (Agent + Manual Analysis)  
**Escopo:** Refatoração UI/UX + Sidebar Retrátil

---

## 🎯 Descobertas Principais

### ✅ Implementado (Bem Feito)
- Navegação bottom-nav com drawer lateral
- Padrão card/table dual (mobile/desktop)
- Safe area handling (notch, home bar)
- Theme system light/dark
- iOS zoom prevention (text-base inputs)

### ⚠️ Gaps Identificados
- **Viewport meta:** Falta explícita (vai usar Next 14 default + custom)
- **Desktop-first:** Precisa mobile-first refactor
- **Touch targets:** Inconsistente (some 40px, need 44px min)
- **Breakpoints:** Mistos (sm/md/lg) - padronizar
- **Responsive typography:** Alguns valores fixos

---

## 📐 Arquitetura Atual

```
AppShell
├── Sidebar (hidden md:flex, w-72, sticky)
│   ├── Logo + branding
│   ├── Nav items (sections)
│   ├── Theme toggle
│   └── User menu
├── Main (flex-1, p-4 md:p-10)
└── MobileNav (md:hidden, fixed bottom, z-40)
    ├── 5 primary items
    └── "Mais" menu (drawer, MobileMenu)
```

---

## 🚀 Fase 6: SidebarWithToggle + Mobile-First Refactor

### Timeline: 1 Semana

#### Commit 1: Viewport Meta + Tailwind Config
- [ ] Adicionar viewport meta explícita em layout.tsx
- [ ] Custom breakpoint: xs (375px)
- [ ] Padding scale: xs→sm→md→lg→xl
- [ ] Touch target scale (40px, 44px, 48px)

#### Commit 2: SidebarWithToggle Component
- [ ] Novo component: `src/components/sidebar-with-toggle.tsx`
- [ ] Props:
  - `defaultExpanded?: boolean`
  - `responsive?: boolean`
  - `mobileVariant?: "drawer" | "bottom-sheet"`
  - `onStateChange?: (state) => void`
- [ ] localStorage: `"b2c:sidebar:state"`
- [ ] Animations: 300ms ease-out

#### Commit 3: MobileHeader Component
- [ ] Novo component: `src/components/mobile-header.tsx`
- [ ] Hamburger toggle
- [ ] Title center
- [ ] Actions right (theme, user)
- [ ] Sticky top com safe area

#### Commit 4: AppShell Refactor
- [ ] Usar SidebarWithToggle (substitui Sidebar)
- [ ] Usar MobileHeader (novo)
- [ ] Manter MobileNav ou remover
- [ ] Testar desktop + mobile + tablet

#### Commit 5: TouchButton + Input Refactor
- [ ] Garantir 44px height em buttons
- [ ] 16px font em inputs (prevent iOS zoom)
- [ ] Padding scale: 12px-20px
- [ ] Border radius: 8px-12px

#### Commit 6: Cards + Forms Refactor
- [ ] Card padding: p-3 sm:p-4 md:p-6
- [ ] Input/Select: 44px height, 16px font
- [ ] Dialog: full-width mobile, centered desktop
- [ ] Responsive labels

#### Commit 7: Performance + Lighthouse
- [ ] Build check: 0 errors
- [ ] Mobile Lighthouse ≥ 70
- [ ] No regressions

---

## 🎨 Design System Specifications

### Colors (Validated 4.5:1 WCAG AA)

**Light Mode**
- Primary: #2563EB (blue-600)
- Success: #10B981 (emerald-500)
- Warning: #F59E0B (amber-500)
- Error: #EF4444 (red-500)

**Dark Mode**
- Primary: #60A5FA (blue-400)
- Success: #34D399 (emerald-400)
- Warning: #FBBF24 (amber-400)
- Error: #F87171 (red-400)

### Spacing (8px base)

```
xs: 4px    (rare)
sm: 8px    (gaps)
md: 12px   (card padding)
lg: 16px   (container)
xl: 24px   (sections)
2xl: 32px  (desktop)
```

### Typography Scale

| Level | Mobile | Desktop | Usage |
|-------|--------|---------|-------|
| h1 | 24px | 32px | Page title |
| h2 | 18px | 24px | Section title |
| body | 14px | 16px | Content |
| small | 12px | 12px | Labels |

### Touch Targets

- Primary: 44x44px min (Apple)
- Secondary: 40x40px min
- Spacing: 8px between targets

---

## 📋 Implementation Tasks

### Task 1: Viewport & Config (2h)
```tsx
// layout.tsx
export const metadata = {
  viewport: {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    maximumScale: 5,
    userScalable: true
  }
}
```

```ts
// tailwind.config.ts
screens: {
  xs: "375px",   // iPhone SE
  sm: "640px",
  md: "768px",
  lg: "1024px",
  xl: "1280px",
  "2xl": "1536px"
}
```

### Task 2: SidebarWithToggle (4h)
```tsx
// src/components/sidebar-with-toggle.tsx
export function SidebarWithToggle({ 
  defaultExpanded = false,
  responsive = true,
  user 
}) {
  const [expanded, setExpanded] = useLocalStorage("b2c:sidebar", defaultExpanded);
  
  // Desktop: always expanded
  // Tablet: toggle visible, starts collapsed
  // Mobile: drawer only
  
  return (
    <> 
      <button 
        onClick={() => setExpanded(!expanded)}
        className="md:hidden p-2 h-10 w-10" // 40px on mobile
      >
        <Menu className="h-6 w-6" />
      </button>
      
      <aside className={cn(
        "md:w-72 transition-all duration-300",
        expanded ? "w-72" : "w-20"
      )}>
        {/* Sidebar content */}
      </aside>
    </>
  );
}
```

### Task 3: MobileHeader (3h)
```tsx
// src/components/mobile-header.tsx
export function MobileHeader({ title, onMenuClick, user }) {
  return (
    <header className="sticky top-0 z-50 md:hidden bg-background/95 backdrop-blur border-b h-14 flex items-center px-3 gap-2" style={{ paddingTop: "var(--safe-area-inset-top, 0)" }}>
      <button onClick={onMenuClick} className="h-10 w-10 flex items-center justify-center">
        <Menu className="h-5 w-5" />
      </button>
      
      <h1 className="flex-1 font-semibold truncate">{title}</h1>
      
      <ThemeToggle size="sm" />
      <UserMenu user={user} size="sm" />
    </header>
  );
}
```

### Task 4: TouchButton Pattern (2h)
```tsx
// Tailwind utilities
@layer components {
  .btn-touch {
    @apply min-h-[44px] px-4 py-3 rounded-lg font-medium transition-all;
  }
  
  .btn-touch-primary {
    @apply btn-touch bg-primary text-primary-foreground hover:bg-primary/90;
  }
  
  .btn-touch-secondary {
    @apply btn-touch bg-secondary text-secondary-foreground hover:bg-secondary/90;
  }
}

// Usage
<button className="btn-touch-primary w-full">Ação</button>
```

---

## ✅ Success Criteria

### Code
- [ ] 0 build errors
- [ ] 0 TypeScript errors
- [ ] No regressions in existing features

### Mobile
- [ ] Sidebar retrátil: smooth, no lag
- [ ] All buttons ≥ 44px
- [ ] All inputs: 16px font (no iOS zoom)
- [ ] LightHouse Mobile ≥ 70

### UX
- [ ] Header sticky + safe area
- [ ] Sidebar toggle persists (localStorage)
- [ ] Drawer overlay on mobile
- [ ] Animation smooth (300ms)

### Design
- [ ] Colors: 4.5:1 contrast WCAG AA
- [ ] Spacing: consistent scale (8px base)
- [ ] Typography: responsive hierarchy

---

## 🚦 Status Timeline

**Semana 1: Fase 6 (Mobile-First Foundation)**
- Mon 15/07: Viewport + Tailwind + SidebarWithToggle (Commits 1-2)
- Tue 16/07: MobileHeader + AppShell refactor (Commits 3-4)
- Wed 17/07: TouchButton + Input refactor (Commits 5-6)
- Thu 18/07: Cards + Forms refactor (extra)
- Fri 19/07: Performance + Lighthouse (Commit 7)

**Semana 2: Fases 7-8 (UI Refinement + QA)**
- Mon 22/07: Dialog/Modal + FAB (Fase 7)
- Tue 23/07: Tables + Animations (Fase 7)
- Wed 24/07: Dark mode + Accessibility (Fase 8)
- Thu 25/07: Cross-browser testing (Fase 8)
- Fri 26/07: Final QA + LightHouse ≥80 (Fase 8)

---

## 📚 Referências

- Tailwind Responsive: https://tailwindcss.com/docs/responsive-design
- Touch Targets: 44x44px (Apple), 48x48px (Google)
- Web Vitals: https://web.dev/vitals/
- WCAG 2.1 AA: https://www.w3.org/WAI/WCAG21/quickref/

---

**Pronto para:** `git commit` e começar Fase 6

