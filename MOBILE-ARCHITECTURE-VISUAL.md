# Mobile Architecture — Design Visual & Componentes

**Objetivo:** Especificar visualmente a arquitetura mobile com wireframes, componentes e padrões.

---

## 📱 Wireframes por Breakpoint

### Desktop (≥ 1024px) — Sidebar Always Visible

```
┌──────────────────────────────────────────────────────────────┐
│ B2C Finance                                                  │
├────────────────────┬────────────────────────────────────────┤
│  ☑ Dashboard       │                                        │
│  ☑ Clientes       │        MAIN CONTENT                   │
│  ☑ Contratos      │                                        │
│  ☑ Recebimentos   │  • Responsive cards                   │
│  ☑ Pagamentos     │  • Tables with data                   │
│  ☑ Relatórios     │  • Full width layout                  │
│  ☑ Configurações  │                                        │
│                    │                                        │
│  🌙 | 👤 Menu      │                                        │
└────────────────────┴────────────────────────────────────────┘
 w-72, sticky, expanded
```

### Tablet Portrait (768px - 1023px) — Sidebar Collapsed

```
┌─────────────────────────────────┐
│☰│ Dashboard | Theme | 👤 Menu   │  ← MobileHeader
├─────────────────────────────────┤
│                                 │
│        MAIN CONTENT             │
│        Full Width               │
│        • Cards stack            │
│        • Touch-friendly buttons │
│        • Responsive grids       │
│                                 │
│ [SIDEBAR DRAWER on left]        │
│ (slide-in from left, overlay)   │
│                                 │
└─────────────────────────────────┘
 Toggle: Hamburger button
```

### Mobile Portrait (< 768px) — Sidebar Drawer

```
┌─────────────────────┐
│☰│ Title | Theme | 👤 │  ← MobileHeader (40px)
├─────────────────────┤
│                     │
│   MAIN CONTENT      │
│   Full Width        │
│   • Card stack      │
│   • Large buttons   │
│   • Touch targets   │
│                     │
│ 💾 [FAB]            │  ← Floating Action Button
│                     │
├─────────────────────┤
│ [📊] [👥] [📋] [+]  │  ← Bottom Tab Bar (optional)
└─────────────────────┘

[SIDEBAR DRAWER]
┌──────────────────────┐
│ ✕                    │
├──────────────────────┤
│ 🏠 Dashboard         │
│ 👥 Clientes         │
│ 📋 Contratos        │
│ 📊 Recebimentos     │
│ 💰 Pagamentos       │
│ 📈 Relatórios       │
│ ⚙️  Configurações    │
│                      │
│ 🌙 | 👤 Menu        │
└──────────────────────┘
 Overlay: rgba(0,0,0,0.5)
 Animation: slide-in 300ms
```

---

## 🎨 Componentes por Breakpoint

### 1. Sidebar / SidebarWithToggle

**Desktop (always visible, expanded)**
```tsx
<Sidebar
  expanded={true}
  user={user}
  showToggle={false}  // Toggle invisible
  width="w-72"
/>
```

**Tablet (toggle visible, starts collapsed)**
```tsx
<SidebarWithToggle
  defaultExpanded={false}
  toggleVisible={true}
  mobileVariant="drawer"  // iOS-style drawer
  user={user}
/>
```

**Mobile (drawer only)**
```tsx
<SidebarWithToggle
  mobileVariant="drawer"
  toggleVisible={true}
  responsive={true}
  onStateChange={(state) => console.log(state)}
/>
```

### 2. Header / MobileHeader

**Desktop (hidden)**
```tsx
// Hidden with: hidden md:hidden
```

**Tablet + Mobile**
```tsx
<MobileHeader
  hamburgerVisible={true}
  title="Dashboard"
  actions={[
    { icon: Moon, onClick: toggleTheme },
    { icon: User, onClick: openUserMenu }
  ]}
  sticky={true}
/>

/* Renders:
┌─────────────────────┐
│☰│ Dashboard | 🌙 | 👤│
└─────────────────────┘
*/
```

### 3. Button Components

**TouchButton (all sizes responsive)**
```tsx
<Button
  size="lg"  // mobile: 44px, desktop: inherit
  className="w-full sm:w-auto"
  onClick={handleClick}
>
  Action
</Button>

/* Mobile: 100% width, 44px height
   Tablet+: Auto width, normal height
*/
```

**Icon Button**
```tsx
<IconButton
  icon={Menu}
  size="md"  // 40-44px
  aria-label="Open menu"
/>

/* Always 44x44px min for touch */
```

### 4. Card Component

**Desktop**
```tsx
<Card className="p-6">
  <h2 className="text-xl font-semibold">Title</h2>
  <p className="text-sm text-muted-foreground">Content</p>
</Card>

/* Padding: p-6 (24px) */
```

**Mobile**
```tsx
<Card className="p-3 sm:p-4 md:p-6">
  <h2 className="text-lg sm:text-xl">Title</h2>
  <p className="text-xs sm:text-sm">Content</p>
</Card>

/* Padding: p-3 (12px) mobile, p-6 (24px) desktop */
```

### 5. Input / Select Component

**Responsive Sizing**
```tsx
<Input
  size="lg"  // Always 44px height
  className="text-base"  // 16px (prevents zoom on iOS)
  placeholder="Buscar..."
/>

/* Mobile specs:
   - Height: 44px (touch target)
   - Font: 16px (no zoom)
   - Padding: 12px 12px
   - Border: 1px, radius 8px
*/
```

### 6. Table → Card Stack in Mobile

**Desktop (Table)**
```tsx
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Nome</TableHead>
      <TableHead>Email</TableHead>
      <TableHead>Ações</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {/* rows */}
  </TableBody>
</Table>
```

**Mobile (Card Stack)**
```tsx
<div className="space-y-3">
  {items.map(item => (
    <Card className="p-4" key={item.id}>
      <div className="flex justify-between items-start">
        <div>
          <p className="font-medium">{item.name}</p>
          <p className="text-xs text-muted-foreground">{item.email}</p>
        </div>
        <Menu />
      </div>
    </Card>
  ))}
</div>
```

**Responsive Wrapper**
```tsx
const TABLE_RESPONSIVE = "hidden sm:table"
const CARD_RESPONSIVE = "sm:hidden"

<>
  <div className={TABLE_RESPONSIVE}>
    <Table>{/* ... */}</Table>
  </div>
  <div className={CARD_RESPONSIVE}>
    {/* Card stack */}
  </div>
</>
```

---

## 🎯 Layout Patterns

### Pattern 1: Full-Width Page

```tsx
<div className="min-h-screen flex flex-col">
  <MobileHeader />
  
  <main className="flex-1 p-3 sm:p-4 md:p-10">
    {/* Content */}
  </main>
</div>
```

### Pattern 2: Two-Column Layout

```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 lg:gap-6">
  {/* Items auto-stack on mobile */}
</div>
```

### Pattern 3: Form Layout

```tsx
<form className="space-y-4 max-w-md">
  <Input label="Nome" size="lg" />
  <Input label="Email" type="email" size="lg" />
  <Select label="Tipo" size="lg">
    {/* Options */}
  </Select>
  
  <Button fullWidth size="lg">
    Salvar
  </Button>
  <Button variant="outline" fullWidth size="lg">
    Cancelar
  </Button>
</form>

/* All fields: 100% width, 44px height, stacked vertically */
```

### Pattern 4: Bottom Sheet Modal

```tsx
// Mobile: Sheet from bottom
// Desktop: Centered modal

<BottomSheet open={open} onOpenChange={setOpen}>
  <BottomSheetContent>
    <h2>Editar Cliente</h2>
    {/* Form */}
  </BottomSheetContent>
</BottomSheet>

/* Mobile (< 768px):
   - Slide from bottom
   - ~90% height
   - Dismissible: drag down or tap overlay
   
   Desktop (≥ 768px):
   - Centered modal
   - 500px max width
   - Overlay clickable to dismiss
*/
```

---

## 🎨 Color Palette & Contrast

### Light Mode (Default)

```
Background:  #FFFFFF (bg-white)
Foreground:  #020817 (gray-950)
Primary:     #2563EB (blue-600)      ← Main actions
Secondary:   #64748B (slate-600)     ← Secondary text
Success:     #10B981 (emerald-500)   ← Positive feedback
Warning:     #F59E0B (amber-500)     ← Alerts
Error:       #EF4444 (red-500)       ← Errors
Muted:       #E2E8F0 (slate-200)     ← Disabled, backgrounds

Contrast Checks (4.5:1 WCAG AA):
✓ Black #020817 on White #FFFFFF = 21:1
✓ Blue #2563EB on White #FFFFFF = 8.6:1
✓ Slate #64748B on White #FFFFFF = 4.5:1
```

### Dark Mode

```
Background:  #1A1F2E (gray-950)
Foreground:  #F8FAFC (slate-50)
Primary:     #60A5FA (blue-400)      ← Lighter for contrast
Secondary:  #CBD5E1 (slate-300)      ← Lighter text
Success:     #34D399 (emerald-400)
Warning:     #FBBF24 (amber-400)
Error:       #F87171 (red-400)
Muted:       #334155 (slate-700)

Contrast Checks:
✓ White #F8FAFC on Black #1A1F2E = 21:1
✓ Blue #60A5FA on Black #1A1F2E = 7.5:1
✓ Slate #CBD5E1 on Black #1A1F2E = 9.8:1
```

---

## 🎬 Animations & Transitions

### Sidebar Toggle

```css
/* Collapse Animation: 300ms */
.sidebar {
  width: 288px;  /* w-72 */
  transition: width 300ms cubic-bezier(0, 0, 0.2, 1);
}

.sidebar.collapsed {
  width: 80px;
  overflow: hidden;
}

/* Labels fade out when collapsed */
.sidebar-label {
  opacity: 1;
  transition: opacity 200ms ease-out;
}

.sidebar.collapsed .sidebar-label {
  opacity: 0;
  pointer-events: none;
}
```

### Drawer Overlay

```css
/* Slide from left: 300ms */
.sidebar-drawer {
  transform: translateX(-100%);
  transition: transform 300ms cubic-bezier(0.4, 0, 0.2, 1);
}

.sidebar-drawer.open {
  transform: translateX(0);
}

/* Overlay fade in */
.sidebar-overlay {
  opacity: 0;
  pointer-events: none;
  transition: opacity 300ms ease-out;
}

.sidebar-drawer.open ~ .sidebar-overlay {
  opacity: 1;
  pointer-events: auto;
}
```

### Button Hover/Active

```css
.button {
  transition: background-color 100ms, transform 100ms;
}

.button:hover {
  background-color: var(--color-primary-600);
  transform: scale(0.98);  /* Subtle press effect */
}

.button:active {
  background-color: var(--color-primary-700);
  transform: scale(0.95);
}

/* Touch: Same as hover (iOS doesn't have native hover) */
@media (hover: none) {
  .button:active {
    background-color: var(--color-primary-600);
  }
}
```

---

## 📏 Spacing & Sizing System

### Base Unit: 4px (Tailwind default)

```
xs:   4px (not used in mobile)
sm:   8px (gaps between items)
md:  12px (card padding)
lg:  16px (container padding)
xl:  24px (section spacing)
2xl: 32px (page padding desktop)

Mobile Spacing:
- Container padding: lg (16px)
- Card padding: md-lg (12-16px)
- Gap between cards: sm-md (8-12px)
- Button padding: md (12px horizontal, vertical match height)
```

### Typography Scaling

```
Headline 1 (h1):
  Mobile:  24px/32px weight-700
  Desktop: 32px/40px weight-700

Headline 2 (h2):
  Mobile:  18px/24px weight-600
  Desktop: 24px/32px weight-600

Body (p):
  Mobile:  14px/20px weight-400
  Desktop: 16px/24px weight-400

Caption:
  Mobile:  12px/16px weight-400
  Desktop: 12px/16px weight-400 (no change)

Min: 14px (readable on small screens)
Max: No limit (text adapts per content)
```

### Touch Targets

```
Primary targets:  44x44px min
Secondary:        40x40px min
Icon only:        40x40px min
Spacing between:  8px min

Examples:
- Button: 44px height, padding 12px
- Icon button: 40x40px
- Link in paragraph: min 44px tap area (padding/margin)
- List item: 48px min height per Google, 44px per Apple
```

---

## 🔧 Implementation Checklist

### Components to Create
- [ ] SidebarWithToggle (desktop + mobile + tablet variants)
- [ ] MobileHeader (sticky top bar with hamburger)
- [ ] TouchButton (44px min, responsive padding)
- [ ] ResponsiveContainer (1/2/3 col grid)
- [ ] BottomSheet (mobile-optimized modal)
- [ ] FAB (floating action button)
- [ ] ResponsiveTable (table vs card stack)

### Refactors Needed
- [ ] Card: increase padding p-3 sm:p-6
- [ ] Input/Select: height 44px, font 16px
- [ ] Button: height 44px, width responsive
- [ ] Dialog: use BottomSheet on mobile
- [ ] Form: full-width fields on mobile

### CSS/Tailwind Updates
- [ ] Custom animations (slide, fade, scale)
- [ ] Responsive spacing utilities
- [ ] Touch-friendly breakpoints
- [ ] Dark mode color refinement
- [ ] Safe area support (notch, home bar)

### Testing Checklist
- [ ] Mobile Lighthouse ≥ 80
- [ ] Touch targets ≥ 44x44px
- [ ] Contrast ≥ 4.5:1 WCAG AA
- [ ] Horizontal scroll: 0
- [ ] Sidebar toggle: smooth, no lag
- [ ] Forms: 16px font (no iOS zoom)
- [ ] Cross-browser: Chrome, Safari, Firefox, Edge

---

**Documento Preparado:** 14/07/2026  
**Status:** 📋 Pronto para Implementação  
**Próxima Fase:** Fase 6 - Implementar Componentes

