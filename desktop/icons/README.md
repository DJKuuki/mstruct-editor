# Transparent application icon / 透明应用图标

Derived from the archived MStruct A V3 mark: black `#252529` on a transparent background. The complete mark is enlarged uniformly without clipping; the 512px master has 2px above the stem and below the brackets. Smaller PNGs keep 1–2px padding. The notehead remains at x=256 in the master.

沿用 A V3 墨黑标志，背景透明；整枚图形等比例放大，不裁括号。512px 母版符杆顶部与括号底部各留 2px，小尺寸 PNG 留 1–2px；符头中心仍为 x=256。构建所需的矢量和多尺寸 PNG 均随本仓库提供。

The vector source is `../icon.svg`; this folder holds its PNG sizes. The desktop build packs these checked-in PNGs into an ICO with `npm.cmd run desktop:icon` and does not require the private website or a rasterizer. Preserve the brand's proportions when updating source artwork; brand rights are described in `../../LICENSE-SCOPE.md`.

矢量源为 `../icon.svg`，本目录保存对应的多尺寸 PNG。桌面构建通过 `npm.cmd run desktop:icon` 将已保存 PNG 装配为 ICO，无需私有主站或图像工具。更新原图时保留品牌比例；品牌权利见 `../../LICENSE-SCOPE.md`。

2026-10-26: The stem and flag share one continuous contour, removing the translucent rasterization seam without changing the silhouette or proportions. All PNG sizes use this corrected vector.

2026-10-26：符杆与符尾采用同一连续轮廓，消除栅格化的半透明接缝，外形与比例保持；全部尺寸 PNG 已同步此矢量修订。
