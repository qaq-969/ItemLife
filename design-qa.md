# Design QA

## Evidence

- Source visual truth: `qa/reference-palette.jpg` (暮山蓝 `#4A5F8C`、晚桃粉 `#E8B4A2`)
- Desktop implementation: `qa/login-desktop.png`, `qa/register-desktop.png`, `qa/mfa-desktop.png`
- Mobile implementation: `qa/login-mobile.png`, `qa/register-mobile.png`, `qa/mfa-mobile.png`
- Combined comparisons: `qa/comparison-desktop.jpg`, `qa/comparison-mobile.jpg`
- Desktop viewport: 1440 × 1000 CSS px, device scale factor 1
- Mobile viewport: 390 × 844 CSS px, device scale factor 1
- Source pixels: 1086 × 1448; desktop captures: 1440 × 1000; mobile captures: 390 × 844
- Density normalization: comparison sheets proportionally scale each source without stretching; no density conversion was required.
- State: default login, default registration, default MFA verification.

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: the Chinese serif display hierarchy follows the editorial tone of the reference; smaller form copy remains readable with system sans-serif fallbacks.
- Spacing and layout rhythm: desktop pages use distinct login, registration, and MFA compositions; cards, radii, borders, and elevation remain consistent. Mobile pages collapse to a single column without horizontal overflow. Registration intentionally scrolls vertically because it contains four fields.
- Colors and visual tokens: primary blue and peach accents map directly to the supplied palette, with ivory translucent surfaces and blue foreground text.
- Image quality and asset fidelity: the generated mountain-and-botanical background matches the supplied soft mountain, peach light, and leaf-shadow direction; it is used as a real raster asset rather than a CSS approximation.
- Copy and content: fields match the `beta-czw` flow—email/password login, email/optional nickname/password confirmation registration, and dynamic or recovery code MFA.
- Accessibility and behavior: visible labels are present, focus styles are defined, controls meet practical mobile sizing, and reduced-motion preferences are respected. Pages are intentionally static HTML, so submission behavior is out of scope.

Focused-region comparison was not required: the desktop and mobile combined sheets keep the complete forms legible enough to verify labels, inputs, button hierarchy, card treatment, and background crop.

## Comparison history

- Pass 1: compared the reference and all three desktop captures in `qa/comparison-desktop.jpg`; no P0/P1/P2 mismatch was found.
- Pass 2: compared the reference and all three 390 px mobile captures in `qa/comparison-mobile.jpg`; no overlap or horizontal clipping was found. The longer registration form correctly continues below the viewport.

## Final result

final result: passed
