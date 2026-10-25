# 题目控制面板格式

“从题目新建”时，AI 在作图指令（见 commands.md）之外还会返回 `panel`，用来生成右侧“题目”标签页中的控制面板。下面的内容与 AI 提示词（`js/ai/problem.js` 中的 `BUILD_EXTRA`）一致。

程序会：
- 检查 `params` 中的动点是否真的是动点、范围是否合理；
- 对 `extrema` 中的每一项在参数范围内独立扫描求最值，与 `ai` 中 AI 自己算出的结果对比（一致 ✓ / 不一致 ✗）；
- 不一致时提供“一键检查问题”，把题目、图形、面板和双方结果发给 AI 诊断，并可一键应用修正。


用户会给出一道题目的结构化信息（已经人工确认），当前画布是空的。请：
1. 用作图指令把题目中的图形完整画出来（几何体、题目中出现的所有点和线、必要的面），并显示关键点的标签。
2. 生成"题目控制面板"：一组为这道题量身定做的按钮，用来演示题目（动点运动、跳到最值位置、显示辅助线、转视角等）。

## 动点要求（最重要）
- 题目中的动点必须用"动点"指令创建，不能用固定坐标：
  · 线段 / 直线上的动点：pointOnLine，并且 "locked": false（参数 t：M = A + t·(B−A)）
  · 圆上的动点：pointOnCircle（参数 ang，单位度）；球面上的动点：pointOnSphere（参数 th、ph）
  · 平面内的动点：pointOnPlane（参数 u、v）；到定点距离一定的动点：fixedLenPoint（参数 th、ph）
- 每个动点的参数都要在 panel.params 中列出，并根据题目条件算出参数的取值范围 min、max（如 M 在线段 BD 上：0～1；"M 在 BD 上且 BM ≤ 1"：按长度换算）。
- 依赖动点的点（如动点与某线的交点、中点）用构造指令作出，它们会随动点自动变化。

## 输出格式
只输出一个 JSON 对象（```json 代码块），在原来的 thought、commands、message 之外增加 panel：
```json
{
  "thought": "作图思路",
  "commands": [ ...作图指令... ],
  "message": "给用户的说明",
  "panel": {
    "title": "题目标题",
    "params": [ { "id": "P1", "target": "M", "key": "t", "min": 0, "max": 1, "label": "M 在线段 BD 上的位置 BM:BD" } ],
    "buttons": [ { "label": "按钮文字（简短）", "desc": "按钮作用说明", "actions": [ ...动作... ] } ],
    "extrema": [
      {
        "label": "ME 的最小值",
        "type": "min",
        "params": ["P1"],
        "target": { "op": "sum", "terms": [ { "coef": 1, "measure": { "type": "length", "items": ["M", "E"] } } ] },
        "ai": { "value": "√6/2", "valueNum": 1.2247448714, "at": [0.5], "atDesc": "M 为 BD 中点时" }
      }
    ],
    "answers": [ { "q": "(1)", "text": "简要答案或思路" } ]
  }
}
```

## 按钮的动作（actions 按顺序执行）
- {"do":"set","param":"P1","value":0.5,"seconds":1} —— 把动点参数平滑地设为某值（seconds 为动画时长，可省略）
- {"do":"play","param":"P1","from":0,"to":1,"seconds":4,"loop":true,"trace":false} —— 动画：参数从 from 变到 to（loop 为 true 时来回循环），trace 为 true 时同时描出该动点的轨迹
- {"do":"stop"} —— 停止动画
- {"do":"extremum","index":0} —— 跳到 extrema[index] 的最值位置（由程序精确计算），并显示结果
- {"do":"show","targets":["AE","β"]} / {"do":"hide","targets":[...]} / {"do":"toggle","targets":[...]} —— 显示 / 隐藏 / 切换对象（用名称）
- {"do":"draw","commands":[ ...作图指令... ]} —— 执行作图指令（如作辅助线、截面、展开图）；第一次点击时作出，再次点击切换显示 / 隐藏
- {"do":"view","az":30,"el":20} —— 转到指定视角（az 水平角、el 俯仰角，单位度）；{"do":"view","preset":"figure"} 与题目示意图同视角；{"do":"view","preset":"default"} 默认视角
- {"do":"trace","param":"P1","mode":"full"} —— 扫描参数范围，画出动点的完整轨迹；"mode":"clear" 清除轨迹
- {"do":"text","text":"……"} —— 在面板上显示一段说明（如结论）
- {"do":"measure","measure":{"type":"length","items":["P","M"]}} —— 作出并显示一个度量（格式同 measure 指令）

## 按钮设计建议
- 根据题目的问题来设计 3～6 个按钮，例如："演示 M 的运动""跳到最小值位置""作出二面角的平面角""展开侧面看最短路径""回到示意图视角"。
- 按钮文字要短（10 字以内），desc 说明作用。
- 只使用上面列出的动作；作图请放在 draw 里，名称不要与已有对象重复。

## 最值 / 取值范围（extrema）
- 题目要求最值、取值范围，或"是否存在点使……"时，必须在 extrema 中列出要考察的量。
- target 为若干度量的组合：op 可为 "sum"（Σ coef·度量）、"product"（乘积）、"ratio"（第 1 项 / 第 2 项）；度量格式同 measure 指令的 type 和 items。角度类度量一律按"度"计算。
- params 列出影响该量的动点参数 id（1～2 个）。
- ai 中给出你自己算出的结果：value 为精确值（字符串），valueNum 为数值，at 为取得最值时各参数的值（与 params 一一对应），atDesc 用文字说明位置。程序会独立扫描验证，并与你的结果对比，请认真计算。
- 求取值范围时，分别列出 min 和 max 两项。
