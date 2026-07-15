# Mobile Architecture — Plano de Refatoração UI/UX

**Objetivo:** Transformar B2C Finance em uma plataforma mobile-first com sidebar retrátil, componentes responsivos e UX otimizada.

**Escopo:** Fases 6-8 (após Deploy Fase 5)  
**Prioridade:** Alta (impacto direto na usabilidade)  
**Estimativa:** 2-3 semanas (Fases 6, 7, 8)

---

## 📊 Estado Atual (Baseline)

### Estrutura Existente
```
AppShell (root)
├── Sidebar (hidden md:flex)           ← Desktop apenas
│   ├── Logo + Branding
│   ├── Nav Items (seções)
│   ├── Theme Toggle
│   └── User Menu
├── Main Content (flex-1, p-4 md:p-10) ← Responsive padding
└── MobileNav (md:hidden, bottom fixed)  ← Mobile bottom tab bar
    ├── Primary items (4-5)
    └── "Mais" menu (MobileMenu)
```

### Breakpoints Atuais
- Mobile: < 768px (md:)
- Desktop: ≥ 768px

### Componentes UI (13)
- Cards, Badge, Button, Dialog, Dropdown, etc.
- **Gap:** Poucos componentes otimizados para tamanho mobile

### Padding/Spacing
- Desktop: `p-10` (40px)
- Mobile: `p-4` (16px)
- **Gap:** Sem escala progressiva (sm → md → lg)

---

## 🎯 Metas Mobile-First

### 1. Sidebar Retrátil (Collapsible)
- [x] Planejado
- [ ] Implementado
  - Estado: collapsed | expanded
  - Animação suave (transição 300ms)
  - Atalho toggle (Hamburger + label)
  - Persiste em localStorage
  - Suporta swipe gesture (opcional)

### 2. Componentes Responsivos
- [x] Planejado
- [ ] Implementado
  - Buttons: 44px min (touch target)
  - Text: 16px min (leitura)
  - Bordas: 12px-16px border-radius
  - Padding: 12px-20px (não 40px)
  - Espaçamento: 8px grid

### 3. UX/UI Mobile Otimizada
- [x] Planejado
- [ ] Implementado
  - Cores: Palette mobile-friendly
  - Animações: Transições suaves (200-300ms)
  - Templates: Cards, Lists, Forms otimizados
  - Tipografia: Hierarchy clara (3-4 níveis)

### 4. Navegação Inteligente
- [x] Planejado
- [ ] Implementado
  - Sidebar adaptável (mobile + desktop)
  - Breadcrumb em mobile (quando profundidade > 2)
  - Quick actions (FAB ou bottom sheet)
  - Back button nativo

---

## 📐 Arquitetura Nova

### Layout Responsivo

**Desktop (≥ 1024px)**
```
┌─────────────────────────────────────────┐
│ Sidebar (w-72, sticky, expanded)        │ Main
│ ├─ Logo                                 │ Content
│ ├─ Nav Sections                         │ Area
│ ├─ (flex-1)                             │
│ └─ User Menu                            │
└─────────────────────────────────────────┘
        Sidebar                Main
```

**Tablet (768px - 1023px)**
```
┌──────────────────────────────┐
│ ☰ │ Main Content Area        │
│   │ Sidebar collapsed         │
│   │ (toggle on demand)        │
│   │                           │
└──────────────────────────────┘
```

**Mobile (< 768px)**
```
┌────────────────────┐
│ ☰ Header           │  ← Hamburger + Title
├────────────────────┤
│                    │
│ Main Content Area  │
│ (full width)       │
│                    │
├────────────────────┤
│ [📊] [👥] [📋] [+] │  ← Bottom Tab Bar (opcional)
└────────────────────┘
  Sidebar in Drawer
  (slide from left)
```

### Estado Sidebar (Novo)

```typescript
type SidebarState = "expanded" | "collapsed";

// Storage
localStorage.getItem("sidebar:state") // "expanded" | "collapsed"

// Comportamento
- Desktop (≥1024px): default "expanded" (sempre visível)
- Tablet (768-1023px): default "collapsed" (toggle on demand)
- Mobile (<768px): default "collapsed" (drawer overlay)
```

---

## 🔧 Componentes a Criar/Refatorar

### Novos Componentes

#### 1. **SidebarWithToggle** (Substitui Sidebar)
```tsx
- Props: 
  - user: UserLike
  - defaultState?: "expanded" | "collapsed"
  - responsive?: boolean (auto-collapse mobile)
- Features:
  - Hamburger toggle (mobile/tablet)
  - Smooth animation (300ms)
  - Collapse/Expand icons
  - Local storage persistence
  - SSR safe
```

#### 2. **ResponsiveContainer**
```tsx
- Props:
  - padding?: "sm" | "md" | "lg" (mobile responsive)
  - gap?: number (grid gap)
- Layouts:
  - 1 col mobile, 2 col tablet, 3 col desktop
  - Auto stacking
```

#### 3. **TouchButton**
```tsx
- Attributes:
  - minHeight: 44px (touch target)
  - padding: 12px 16px
  - borderRadius: 8px-12px
  - Hover/active states
  - Ripple effect (optional)
```

#### 4. **MobileHeader**
```tsx
- Components:
  - Left: Hamburger + Back button
  - Center: Title
  - Right: Actions (1-3)
- Sticky top
- Safe area support
```

#### 5. **BottomSheet** (para modals em mobile)
```tsx
- Animação desliza de baixo
- Drag to dismiss
- Full-screen desktop, half-screen mobile
- Inert + focus management
```

#### 6. **FAB** (Floating Action Button)
```tsx
- Posicionado bottom-right (safe area)
- Mobile primary action
- Expandable menu (opcional)
```

### Refatorações Existentes

#### 1. **Sidebar** → **SidebarWithToggle**
- Adicionar toggle button
- Collapsar ícones + labels
- Animação suave
- Responsive classes

#### 2. **MobileNav** → **BottomTabBar**
- Remover se sidebar funcionar bem em mobile
- Ou manter como alternativa (user preference)

#### 3. **Card, Button, Input, etc.**
- Aumentar padding/altura
- Bordas mais arredondadas
- Melhor contrast (cores)
- Animações mais suaves

#### 4. **Tables** → **ResponsiveTable / MobileCard**
- Desktop: tabela normal
- Mobile: card stack com scroll horizontal
- Overflow tratado melhor

---

## 🎨 Design System Mobile

### Tipografia
```
Display (h1):    32px/40px weight-700
Heading (h2):    24px/32px weight-600
Subheading (h3): 20px/28px weight-600
Body (p):        16px/24px weight-400
Label (small):   14px/20px weight-500
Caption:         12px/16px weight-400

Mobile
------
Display:    24px/32px
Heading:    18px/24px
Subheading: 16px/22px
Body:       14px/20px  ← min 14px para legibilidade
Label:      12px/16px
```

### Spacing Scale (8px base)
```
xs:  4px   (não usar em mobile)
sm:  8px   (margin, small gaps)
md:  12px  (padding, gaps)
lg:  16px  (container padding)
xl:  24px  (section spacing)
2xl: 32px  (page padding em desktop)

Mobile Padding:
- Container: 12px (sides), 16px (vertical)
- Cards: 12px-16px
- Buttons: 12px (padding)
- Lists: 8px (gap)
```

### Touch Targets
```
Buttons:    min 44x44px (Apple), 48x48px (Google)
Inputs:     min 44px height
Links:      min 44px tap area
Spacing:    8px between touch targets
```

### Cores (Palette Mobile)
```
Light Mode (fundo branco):
- Primary: #2563EB (blue, 600)      ← tap states precisam 4.5:1 contrast
- Success: #10B981 (emerald, 500)
- Warning: #F59E0B (amber, 500)
- Error:   #EF4444 (red, 500)
- Neutral: #64748B (slate, 600)

Dark Mode (fundo escuro):
- Primary: #60A5FA (blue, 400)
- Success: #34D399 (emerald, 400)
- Warning: #FBBF24 (amber, 400)
- Error:   #F87171 (red, 400)
- Neutral: #CBD5E1 (slate, 300)

Contrast: 4.5:1 min (WCAG AA)
```

### Animações
```
Entrance:   200ms ease-out
Exit:       150ms ease-in
Interaction: 100ms (hover, active)
Transition: 200-300ms (sidebar collapse)

Easing:
- ease-out: .cubic-bezier(0, 0, 0.2, 1) — entradas
- ease-in:  cubic-bezier(0.4, 0, 1, 1)  — saídas
- ease-in-out: cubic-bezier(0.4, 0, 0.2, 1) — transições
```

---

## 📱 Breakpoints (Otimizado)

```
sm:  640px   (phone landscape)
md:  768px   (tablet portrait) ← Sidebar começa a mudar
lg:  1024px  (tablet landscape / laptop) ← Sidebar sempre expandido
xl:  1280px  (desktop full)
2xl: 1536px  (widescreen)

Regras:
- < 768px:   Sidebar collapsed/drawer
- 768-1024px: Sidebar toggle
- ≥ 1024px:   Sidebar always expanded
```

---

## 🚀 Roadmap de Implementação

### Fase 6: Sidebar Retrátil + Componentes Base (1 semana)
**Commits esperados: 5-6**

- [ ] **Commit 1:** Criar SidebarWithToggle component
  - Adicionar toggle button
  - Implementar estado (expanded/collapsed)
  - Animação suave (Tailwind animation)
  - localStorage persistence

- [ ] **Commit 2:** Refatorar AppShell para usar SidebarWithToggle
  - Remover Sidebar e MobileNav antigos (ou deprecar)
  - Implementar novo layout responsivo
  - Testar desktop + mobile

- [ ] **Commit 3:** Criar TouchButton component
  - minHeight: 44px
  - Padding mobile-optimized
  - Hover/active states

- [ ] **Commit 4:** Refatorar buttons existentes
  - Aplicar TouchButton padrão
  - Aumentar padding
  - Melhorar contrast

- [ ] **Commit 5:** Criar ResponsiveContainer
  - Grid 1/2/3 colunas (mobile/tablet/desktop)
  - Spacing scale
  - Testes de responsividade

- [ ] **Commit 6:** Build & Lighthouse check
  - Performance após mudanças
  - Mobile LightHouse ≥ 70

### Fase 7: UI Components Refinados (1 semana)
**Commits esperados: 6-8**

- [ ] **Commit 1:** Refatorar Card component
  - Aumentar border-radius (12px-16px)
  - Ajustar padding (12px-16px)
  - Shadow melhorado em mobile

- [ ] **Commit 2:** Refatorar Input/Select components
  - minHeight 44px
  - Padding 12px-16px
  - Font-size 16px (previne zoom em iOS)
  - Focus states melhorados

- [ ] **Commit 3:** Refatorar Dialog/Modal
  - BottomSheet em mobile
  - Overlay com dismiss gesture
  - Safe area support

- [ ] **Commit 4:** Criar MobileHeader component
  - Hamburger + Back + Title
  - Sticky top
  - Safe area padding

- [ ] **Commit 5:** Refatorar Tables
  - Card stack em mobile
  - Scroll horizontal com indicador
  - Touch-friendly

- [ ] **Commit 6:** Criar FAB component (Floating Action Button)
  - Bottom-right posicionado
  - Safe area support
  - Expandable menu

- [ ] **Commit 7:** Animações & Transitions
  - Aplicar easing (ease-out, ease-in)
  - Transições suaves (200-300ms)
  - Tailwind animations

- [ ] **Commit 8:** Build & Performance
  - No regression
  - Mobile LightHouse ≥ 75

### Fase 8: Refinamento & QA (1 semana)
**Commits esperados: 4-5**

- [ ] **Commit 1:** Dark mode refinement
  - Cores otimizadas para dark
  - Contrast WCAG AA validado
  - Ambos temas testados

- [ ] **Commit 2:** Scroll behavior & Gestures
  - Smooth scroll em listas
  - Pull-to-refresh (opcional)
  - Swipe gestures (sidebar, drawer)

- [ ] **Commit 3:** Accessibility improvements
  - Touch targets validadas (44x44px min)
  - Focus outlines visíveis
  - Semantic HTML
  - ARIA labels

- [ ] **Commit 4:** Cross-browser testing
  - Chrome (Android)
  - Safari (iOS)
  - Firefox (Android)
  - Edge (todos)

- [ ] **Commit 5:** Performance final
  - LightHouse Mobile ≥ 80
  - First Input Delay < 100ms
  - Cumulative Layout Shift < 0.1

---

## 📋 Checklist por Fase

### Fase 6 Checklist
- [x] Planejado
- [ ] SidebarWithToggle criado
- [ ] AppShell refatorado
- [ ] TouchButton component
- [ ] ResponsiveContainer criado
- [ ] Build clean
- [ ] Mobile LightHouse ≥ 70

### Fase 7 Checklist
- [x] Planejado
- [ ] Card refatorado
- [ ] Input/Select refatorado
- [ ] Dialog/Modal → BottomSheet
- [ ] MobileHeader criado
- [ ] Tables responsivas
- [ ] FAB component
- [ ] Animações implementadas
- [ ] Mobile LightHouse ≥ 75

### Fase 8 Checklist
- [x] Planejado
- [ ] Dark mode refinado
- [ ] Gestures implementadas
- [ ] Accessibility validada
- [ ] Cross-browser testing OK
- [ ] Mobile LightHouse ≥ 80

---

## 🎯 Success Criteria

### Performance
- [ ] LightHouse Mobile ≥ 80
- [ ] LCP < 2s
- [ ] FCP < 1.2s
- [ ] CLS < 0.1

### UX/UI
- [ ] Sidebar retrátil funciona (desktop + mobile)
- [ ] Todos botões ≥ 44x44px
- [ ] Tipografia clara e legível
- [ ] Cores contrastadas (4.5:1 WCAG AA)
- [ ] Animações suaves (200-300ms)

### Accessibility
- [ ] Touch targets ≥ 44x44px
- [ ] Focus outlines visíveis
- [ ] Semantic HTML 100%
- [ ] ARIA labels corretos
- [ ] Keyboard navigation OK

### Responsiveness
- [ ] Mobile (< 768px) otimizado
- [ ] Tablet (768-1024px) OK
- [ ] Desktop (≥ 1024px) mantido
- [ ] Sem horizontal scroll
- [ ] Safe area support (notch, home bar)

---

## 📚 Recursos & Referências

### Documentation
- Tailwind Responsive Design: https://tailwindcss.com/docs/responsive-design
- Web Vitals: https://web.dev/vitals/
- WCAG 2.1 AA: https://www.w3.org/WAI/WCAG21/quickref/

### Components
- Radix UI (accessibility): https://www.radix-ui.com/
- Headless UI: https://headlessui.dev/
- shadcn/ui (existing): https://ui.shadcn.com/

### Touch Design
- Apple HIG: https://developer.apple.com/design/human-interface-guidelines/ios/
- Material Design 3: https://m3.material.io/
- Touch Targets: 44x44px (Apple), 48x48px (Google)

---

## 📝 Notas Técnicas

1. **State Management:**
   - Usar React Context para SidebarState (evitar prop drilling)
   - localStorage para persistência
   - SSR-safe (usar useEffect para hydration)

2. **Animation Library:**
   - Preferir Tailwind animations (tailwindcss-animate)
   - Fallback para CSS transitions
   - Evitar heavy JS libraries (Framer Motion só se necessário)

3. **Responsive Utilities:**
   - Criar Tailwind plugin customizado para scales
   - CSS custom properties para tokens (colors, spacing)
   - MediaQuery hooks para lógica condicional

4. **Mobile First:**
   - Escrever CSS para mobile first (sem breakpoints)
   - Depois expandir com `md:`, `lg:`, `xl:`
   - Testar em devices reais (não apenas DevTools)

5. **Testing:**
   - Lighthouse CI (automatizar checks)
   - Playwright para visual regression
   - Manual testing em devices reais

---

## 💡 Próximos Passos

1. **Hoje:** Validar plano com team
2. **Amanhã:** Iniciar Fase 6 (SidebarWithToggle)
3. **1-2 semanas:** Completar Fases 6, 7, 8
4. **Deploy:** Integrar com Fase 5 ou Fase 6 (versão mobile-first)

---

**Plano Preparado:** 14/07/2026  
**Status:** 📋 Pronto para Implementação  
**Estimativa Total:** 2-3 semanas (Fases 6-8)

