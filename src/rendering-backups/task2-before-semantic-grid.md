# 任务 2：语义 Grid 改造前的稳定渲染备份

备份日期：2026-08-10。此文件记录在“行号对齐、system 间距收紧”已验证之后、Grid 改造之前的可恢复渲染方式。对应视觉基准已在本任务的浏览器检查中截取。

## DOM 方式

- `renderMeasure()` 在 `.measure` 内依次放置起始线或 `.continued-bar-number`、`.measure-content` 和结束线。
- 每个 `.measure-slot` 以绝对定位容纳 `.slot-annotations`、`.time-signature`、`.harmony-stack` 与 `.duration-label`。
- 截断小节（`truncatedByEllipsis`）不添加结束线。

## 已验证的关键尺寸

```css
.chart { gap: 10px; }
.measure { min-height: 150px; }
.measure.one-row { min-height: 140px; }
.score-system.has-top-annotations .measure { min-height: 214px; }
.score-system.has-top-annotations .measure.one-row { min-height: 184px; }
.ellipsis-marker { min-height: 150px; transform: translateY(-3px); }
.line-gutter, .highlight-layer, #sourceInput { font-size: 14px; line-height: 1.7; }
.line-gutter span { height: 1.7em; line-height: 1.7; }
```

## 旧的坐标式对齐（保留用于回退）

```css
.bpm-label { top: -5px; left: 50%; transform: translateX(-50%); }
.time-label { top: 27px; left: 50%; transform: translateX(-50%); }
.time-signature { top: 50%; left: 7px; transform: translateY(-50%); }
.harmony-stack { top: 50%; left: 0; right: 0; transform: translateY(-50%); }
.duration-label { top: calc(50% + 49px); left: 50%; transform: translateX(-50%); }
.tonal-prefix { right: calc(100% + 7px); bottom: 13px; }
```

## 视觉基准

- 行号第一行顶端与源码第一行顶端均为 105px。
- 相邻 system 的网格间距为 10px；首行（含 BPM/时间戳）高度为 214px，后续普通双行 system 高度为 150px。
- 第 4、39、50、51 小节首和弦到起始线中心均为 63px；第 39 小节在省略号前没有结束线。

如新的语义 Grid 排版未达到上述可见效果，应以本备份中的结构和尺寸回退，再单项调整。
