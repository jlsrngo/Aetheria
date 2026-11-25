# Characters, Expressions & Poses (`mg-stickman-story`)

See the visual character sheets: [character-gallery.png](../assets/character-gallery.png) & [hero-rig-qa.png](../assets/hero-rig-qa.png).

## 1. Built-In Cast Presets (13 Total)
- **`afro`** *(default hero)* — Fluffy rounded afro silhouette (2-pass unified contour keeping glasses & brows 100% uncovered), rectangular glasses, teal shirt (`#4A7A7C`), black bowtie tucked right at collar, peach skin arms, dark trousers, black/white sneakers.
- **`nadia`** — Co-lead girl in dark taupe jacket (`#D7B38C`), round glasses, cute chibi sparkle eyes with eyelashes, flowing dark hijab scarf & pleated skirt.
- **`leo`** — Spiky dark hair, energetic crimson tee (`#E05A47`), navy trousers.
- **`ben`** — Curly brown hair, sturdier build, warm mustard tee (`#F2B138`).
- **`sam`** — Neat parted hair, glasses, white shirt with blue tie.
- **`mia`** — Dark bob haircut, bright coral top, skirt.
- **`chloe`** — High ponytail, emerald green tee, sporty sneakers.
- **`dad`** — Tall build, mustache, square glasses, slate-blue shirt & tie.
- **`mom`** — Soft rose hijab, coral pastel blouse, long skirt.
- **`teacher`** — Glasses, mustard-tan coat, classroom instructor look.
- **`ms-claire`** — Navy-slate hijab, round glasses, powder-blue top.
- **`grandpa`** — Silver hair & mustache, round glasses, warm gray sweater.
- **`kid`** — Small `0.76x` scale mini afro silhouette, bright sunny tee (`#FFD166`).

## 2. Expressions (`expr`, 20 Total)
`happy` · `calm` · `neutral` · `laugh` · `excited` · `proud` · `shy` · `angry` *(with red forehead vein & grit teeth)* · `annoyed` · `surprised` · `panic` · `scared` · `sad` *(with teardrops)* · `crying` · `thinking` · `confused` · `suspicious` · `sleepy` · `sleep` · `tired`

## 3. Poses (`pose`, 44 Total)
- **Standing & Greeting:** `idle`, `greet`, `wave`, `wave-both`, `thumbs-up`, `bow` (via `pray`), `pray`, `clap`
- **Explaining & Pointing:** `point-right`, `point-left`, `point-up`, `idea`, `speak`, `explain`, `ask`, `shrug`, `hands-on-hips`, `arms-crossed`, `hands-on-chest`
- **Reaction & Emotion:** `think`, `scratch-head`, `hold-head`, `cover-mouth`, `cover-face`, `surprised`, `cheer`, `jump-joy`, `crying`, `sad`, `angry`, `point-angry`
- **Props & Action:** `hold-right`, `hold-left`, `hold-both`, `read`, `check-phone`, `drink`, `walk`, `run`, `sneak`, `sit`, `sit-desk`, `write`, `squat`, `sleep`

## 4. Stage Anchor Coordinates (World Space, floor `y = 0`)
- Standard solo center standing: `x: 0, y: 0`
- Standard two-shot standing: Actor A `x: -170, y: 0, facing: "right"`, Actor B `x: 170, y: 0, facing: "left"`
- Off-screen run-in (`park`/`street`): start `x: -620` -> action `toX: -140, style: "run"`
- Bedroom sleeping under blanket (`stage: "bedroom"`, `blanket: true`): `x: -158, y: -167, pose: "sleep", expr: "sleep"` (head rests cleanly on pillow while foreground blanket covers torso!)
- Nightstand alarm clock center (`stage: "bedroom"`): `{ "x": 185, "y": -214, "z": 2.8 }`
