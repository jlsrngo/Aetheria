# Worlds, Props & Comic Emotes (`mg-stickman-story`)

## 1. Layered 2.5D Worlds (`stage`, 13 Total)
Each world renders `back()` depth-parallax layers (sky `0.22`, far hills `0.42`, architecture `0.78`, floor `1.0`) BEFORE actors, then renders `front()` occlusion layers (`1.02..1.28`) AFTER actors so beds, blankets, desks, and bushes wrap naturally around characters:
- `bedroom` — Cozy pastel wall, framed art, curtained window, bed with pillow & bunny plush, nightstand with oscillating `07:00` alarm clock, and **foreground pink blanket** occluding sleeping torso.
- `park` — Multi-depth parallax sky & drifting clouds, rolling far hills (`depth 0.42`), park trees & wooden bench (`0.78`), sandy path & flowers (`1.0`), and **foreground edge bushes** (`1.28`).
- `classroom` — Chalkboard wall (`boardText`), teacher's tray, and foreground student desks.
- `study` — Tall bookshelf, study clock, and **foreground wooden desk** for seated reading/writing.
- `living-room` — Pastel picture frames, plush blue sofa, and animated tail-wagging orange cat.
- `street` — Repeating pastel neighborhood houses, trees, sidewalk & striped road for long tracking `follow` shots.
- `school-yard` — Brick-roof school building (`signText`), double wood doors, trees, and courtyard walk.
- `cafeteria` — Striped counter banner (`CANTEEN`) and warm tiled floor.
- `field` — Open green sports pitch with twin goalposts and chalk center ring.
- `house-front` — Warm family home exterior, pitched roof, garden trees, and front lawn.
- `dining-room` — Foreground dinner table with plates so seated characters sit naturally behind it.
- `meadow` — Wide rolling pasture beneath drifting clouds for journey/monologue shots.
- `plain` — Minimal studio sweep (`bgColor`) with subtle ground line for graphic callouts.

## 2. Times of Day (`timeOfDay`, 4 Total)
`morning` *(fresh pastel cyan & cream sun)* · `day` *(crisp bright sky)* · `sunset` *(coral-amber sky + warm `0.10` tint)* · `night` *(deep navy `1B264F`, stars, moonlight tint)*

## 3. Held Props (`actor.prop` or `props[].kind`, 11 Total)
`phone` · `book` · `pencil` · `ball` · `cup` · `gift` · `flower` · `alarm` · `umbrella` · `laptop` · `paper`

## 4. Floating Head Emotes (`actions[].emote` or `props[].kind`, 12 Total)
`exclaim` · `question` · `idea` *(glowing yellow bulb + rays)* · `zzz` *(rising Zs)* · `sparkle` · `star` · `heart` · `angry` · `annoyed` · `sweat` · `check` · `cross` · `music`
