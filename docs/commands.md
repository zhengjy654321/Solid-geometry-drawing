# 作图指令参考

本文与 AI 系统提示词（`js/ai/prompt.js`）中的说明一致。在 AI 面板的“指令”窗口中可以直接粘贴这些指令执行，便于调试或批量作图。

## 一、坐标系与约定
- 右手直角坐标系，z 轴竖直向上。默认视角下 x 轴指向观察者（画面左下方），y 轴指向右方，z 轴向上。
- 长度单位与场景数据一致；角度一律用"度"。
- 名称区分大小写。"A1" 就是 A₁（下标），写成 "A1"。
- 线段/直线可以用名称 "AB" 或数组 ["A","B"] 表示；平面可以用平面名 "α"、多边形名 "ABCD"，或三个点 ["A","B","C"] 表示；立体用它的名称（如 "ABCD-A1B1C1D1"、"P-ABCD"），也可以用它的任一顶点名称表示该立体。
- 所有引用的对象必须已经存在于场景中，或者在前面的指令中已经创建。
- 新建点的名称不能与已有名称重复。优先使用题目中出现的名称；没有指定时选一个未被使用的大写字母。

## 二、输出格式（必须严格遵守）
只输出一个 JSON 对象，放在 ```json 代码块中，不要输出任何其他内容，不要在 JSON 里写注释：
```json
{
  "thought": "一两句话说明作图思路",
  "commands": [ {"op": "...", ...}, ... ],
  "message": "给用户的简短中文说明：画了什么、新对象的名称、关键结论（如角度、长度的精确值）"
}
```
- 数值必须是 JSON 数字（如 1.4142135624），不要写 sqrt(2)、π 等表达式；需要时自己算出足够精确的小数（至少 8 位有效数字）。
- 如果要求无法完成或有歧义，commands 给空数组 []，并在 message 中说明原因或需要用户补充的信息。
- 不要重复创建已经存在的对象；除非用户要求，不要删除对象。

## 三、可用指令（op）
## 点
1. {"op":"point","name":"E","coord":[x,y,z]} —— 坐标点（尽量少用，优先用下面的构造型指令，这样图形是"活"的，改变原图时会自动跟随）
2. {"op":"midpoint","name":"M","a":"A","b":"B"} —— 中点（也可写 "line":"AB"）
3. {"op":"pointOnLine","name":"E","a":"A","b":"B","t":0.333333333,"locked":true} —— E = A + t·(B−A)，即 AE:AB = t；t>1 或 t<0 时在延长线上（此时加 "mode":"line"）
4. {"op":"foot","name":"H","point":"P","plane":"ABC"} 或 {"op":"foot","name":"H","point":"P","line":"BC"} —— 垂足（点在平面/直线上的射影）
5. {"op":"intersection","name":"O","line":"AC","line2":"BD"} —— 两条共面直线的交点；{"op":"intersection","name":"F","line":"PC","plane":["A","E","M"]} —— 直线与平面的交点；{"op":"intersection","line":"AB","circle":"<圆的id>"} / {"op":"intersection","line":"AB","sphere":"球O"} / {"op":"intersection","circle":"<id>","circle2":"<id>"} —— 直线与圆、直线与球面、两个共面圆的交点：不写 which 时把所有交点都作出（names 指定名称数组），写 "which":0 或 1 只作其中一个（按从直线第一个点到第二个点的顺序）
6. {"op":"center","name":"G","type":"centroid","points":["A","B","C"]} —— type 可为 centroid(重心) / circumcenter(外心) / incenter(内心) / orthocenter(垂心)；四个点以上时为平均点
7. {"op":"reflect","name":"Q","point":"P","center":"O"} / {"op":"reflect","name":"Q","point":"P","line":"AB"} / {"op":"reflect","name":"Q","point":"P","plane":"ABC"} —— 对称点
8. {"op":"pointAlongNormal","name":"P","base":"A","plane":"ABCD","dist":2} —— 从 A 沿平面 ABCD 的法向移动 dist（法向朝"上"，dist 可为负）；"plane" 省略时为竖直向上（+z）
9. {"op":"pointOffset","name":"P","base":"A","vector":[0,0,2]} —— P = A + 向量
10. {"op":"pointByVector","name":"D","base":"A","from":"B","to":"C","k":1} —— D = A + k·向量BC（作平行四边形的第四个顶点、平移等）
11. {"op":"rotatePoint","name":"Q","point":"P","axis":["A","B"],"angle":90} —— 点绕轴 AB 旋转 angle 度
12. {"op":"fixedLenPoint","name":"Q","anchor":"A","len":2,"mode":"space","th":30,"ph":20} —— 到 A 距离为 len 的动点（mode 为 "plane" 时需给 "plane"，在该平面内转动）
13. {"op":"pointOnPlane","name":"Q","plane":"ABC","coord":[x,y,z]} —— 平面上距给定坐标最近的点（随平面移动）
14. {"op":"pointOnSphere","name":"Q","sphere":"球O","th":30,"ph":20}；{"op":"pointOnCircle","name":"Q","circle":"<圆的id>","angle":30}

## 线
15. {"op":"segment","a":"A","b":"B"} —— 线段（可选 "style":"dashed" / "solid" / "auto"，默认 auto：被立体挡住的部分自动画成虚线，一般不要指定）
16. {"op":"line","a":"A","b":"B"} —— 直线（两端延长）；{"op":"ray","a":"A","b":"B"} —— 射线

## 面
17. {"op":"polygon","points":["A","B","C"],"fill":true,"color":"#f5a623"} —— 多边形（自动连好各边）；"occlude":true 表示它是实体面，会遮挡后面的线
18. {"op":"plane","name":"α","mode":"threePoints","points":["A","B","C"]} —— 过三点的平面（画成平行四边形）
19. {"op":"plane","name":"α","mode":"pointNormal","point":"A","normal":[0,0,1]} —— 过点、已知法向量
20. {"op":"plane","name":"α","mode":"perpToLine","point":"A","line":"BC"} —— 过点且垂直于直线
21. {"op":"plane","name":"α","mode":"parallelToPlane","point":"A","plane":"BCD"} —— 过点且平行于平面
22. {"op":"plane","name":"α","mode":"throughLinePerpToPlane","line":"AB","plane":"BCD"} —— 过直线且垂直于平面
23. {"op":"plane","name":"α","mode":"throughLineAngleToPlane","line":"AB","plane":"ABC","angle":30,"side":1} —— 过直线且与平面成 angle 度二面角（side 取 1 或 -1 选择两侧之一）
24. {"op":"plane","name":"α","mode":"axis","axis":"xy","offset":1} —— 平行于坐标面的平面（axis: xy / yz / xz，offset 为 z / x / y 的值）

## 立体（模板，自动命名顶点，名称也可以用 "names" 指定）
25. {"op":"solid","shape":"cube","a":2} —— 正方体 ABCD-A1B1C1D1（D 在原点，DA 为 x 轴，DC 为 y 轴，DD1 为 z 轴）
   shape 与参数：
   - cube: a（棱长）
   - cuboid: a（DA，x 向）, b（DC，y 向）, c（高）
   - prism: n（边数）, a（底面边长）, h（高） —— 正 n 棱柱，底面中心在原点
   - pyramid: n, a, h, apex（"center" 正棱锥；"v0" 表示顶点在第 1 个底面顶点正上方，即侧棱垂直底面）—— 顶点名 P
   - rectPyramid: a, b, h, apex（"center" 或 "v0".."v3"）—— 底面为矩形的四棱锥
   - frustum: n, a（下底边长）, a2（上底边长）, h —— 正棱台
   - tetra: a —— 正四面体（顶点 A 在上，BCD 为底）
   - corner: a, b, c —— 墙角三棱锥 P-ABC，PA、PB、PC 两两垂直，P 在原点
   - bienao: a(AB), b(BC), h(PA) —— 鳖臑 P-ABC：PA⊥平面ABC，AB⊥BC
   - qiandu: a(AB), b(BC), h —— 堑堵（底面为直角三角形、∠ABC=90° 的直三棱柱）
   - cylinder: r, h；cone: r, h；coneFrustum: r1, r2, h —— 圆柱/圆锥/圆台（底面圆心 O 在原点，轴沿 z）
   - 平面图形（在 xOy 面上）：triEq(a), triRight(a=BC, b=AC, ∠C=90°), triIso(b 底边, h 高), square(a), rect(a, b), regPoly(n, a), parallelogram(a, b, ang), rhombus(a, ang), trapezoid(a 下底, b 上底, h, kind:"iso"|"right")
   可选 "origin":[x,y,z] 平移整个图形，"names":["A","B",...] 按顶点顺序指定名称。
26. {"op":"extrude","base":["A","B","C"],"mode":"prism","height":2,"names":["A1","B1","C1"]} —— 以已有多边形为底面拉伸成直棱柱；mode 为 "pyramid" 时生成棱锥（给 "apex":"P" 使用已有点作顶点，否则在底面中心上方 height 处新建顶点）；mode 为 "frustum" 时生成棱台（"k" 为上底缩放比）
27. {"op":"hull","points":["A","B","C","D","E"]} —— 由若干点生成凸多面体（自动生成面和棱，被遮挡的棱自动变虚线）。用户自己用点搭出的立体，用它来得到正确的虚实线。

## 球与圆
28. {"op":"sphere","center":"O","radius":2} 或 {"op":"sphere","center":"O","through":"A"} —— 球（"display":"shaded"|"outline"|"wire"）
29. {"op":"circumsphere","solid":"P-ABC"} / {"op":"circumsphere","points":["P","A","B","C"],"centerName":"O"} —— 外接球（自动标出球心）
30. {"op":"insphere","solid":"..."} —— 内切球；{"op":"midsphere","solid":"..."} —— 棱切球（与各棱相切）
31. {"op":"sphereSection","sphere":"球O","plane":["A","B","C"],"withCenter":true} —— 球被平面所截的截面圆
32. {"op":"sphereSolidIntersect","sphere":"球O","solid":"ABCD-A1B1C1D1"} —— 球面与多面体各面的交线（自动给出交线总长）
33. {"op":"circle","center":"O","radius":1,"plane":"ABC"} —— 圆（在平面内）；{"op":"circle","points":["A","B","C"]} —— 过三点的圆

## 截面、翻折
34. {"op":"section","solid":"ABCD-A1B1C1D1","plane":["E","F","G"]} —— 用平面截立体，自动求出截面多边形及各交点（交点自动命名）
35. {"op":"fold","face":["A","B","D"],"axis":["B","D"],"angle":90} —— 翻折：把 face（多边形名或点数组）所在部分绕折痕 axis 旋转 angle 度（0 为展开状态；翻折后两部分所成二面角 = 180° − angle）。"dir":-1 可反向

## 度量与标注
36. {"op":"measure","type":"<类型>","items":[...]} —— 类型：
   length [线段] 或 [点,点]；distPointLine [点,直线]；distPointPlane [点,平面]；distLineLine [直线,直线]；
   angle [A,O,B] 表示 ∠AOB；angleLines [直线,直线]（异面直线所成角）；angleLinePlane [直线,平面]；
   dihedral [平面,平面] 或 [A,B,C,D] 表示二面角 A-BC-D；area [多边形]；volume [立体]；surface [立体]；
   circle [圆]（"what":"len"|"r"|"area"）；sphere [球]（"what":"r"|"S"|"V"）
37. {"op":"rightAngle","points":["A","H","B"]} —— 在 H 处画直角标记；{"op":"angleMark","points":["A","O","B"],"count":1} —— 角的圆弧标记
38. {"op":"text","at":"A","text":"文字"} —— 文字标注（跟随点 A）；也可写 "line":"AB"（跟随线段中点）或 "pos":[x,y,z]（固定位置），可加 "color"、"size"。文字中可写变量，随图形实时变化：{len:A,B} 长度，{ang:A,B,C} ∠ABC，{坐标:A}，{度量:<度量的 id 或名称>}，{面积:ABC}（多边形或三角形面积；写圆 / 截面圆的 id 时为圆面积），{参数:M.t}；末尾加 |e 显示精确值（如 {len:A,C1|e}），|d3 保留 3 位小数

## 修改
39. {"op":"style","targets":["AB","CD"],"dash":"dashed","color":"#d0451b","label":true,"hidden":false} —— 修改样式（dash: auto/solid/dashed；label: 是否显示名称标签）
40. {"op":"labels","targets":["A","B"],"show":true} —— 显示标签（省略 targets 表示全部点）
41. {"op":"rename","target":"E","name":"M"}；{"op":"delete","targets":["E"]}
42. {"op":"setParam","target":"ABCD-A1B1C1D1","key":"a","value":3} —— 修改参数（立体的 a/b/c/h/r 等，点在线上的比例 t，翻折的 angle 等）
43. {"op":"moveTo","target":"E","coord":[x,y,z]} —— 移动自由点
44. {"op":"release","target":"P"} —— 解除点的约束（如沿法向拉起的点、垂足），变为相对基点的平移或自由点；之后可用 setParam 修改 "vec.0" / "vec.1" / "vec.2"（相对基点的 Δx、Δy、Δz），或用 moveTo 移动自由点
45. {"op":"constrain","target":"F","anchor":"A","mode":"plane","axisPlane":"yz"} —— 让点 F 保持到 A 的距离不变，绕 A 转动：mode 为 "space" 时在空间中转动；mode 为 "plane" 时锁定在过 A 且与某平面平行的平面内，平面用 "axisPlane"（xy / yz / xz）、"plane"（已有平面）或 "containAxis"（x / y / z，表示包含当前连线且平行于该坐标轴的平面）指定。之后可用 setParam 修改 "th"（面内角度）或 "len" 

## 四、作图要求
- 优先使用构造型指令（midpoint、foot、intersection、plane 的各种 mode、section、circumsphere 等），而不是自己算坐标。这样用户改动原图时，新作的图会自动跟随。
- 需要计算坐标时，请根据场景数据仔细计算并自行验算。
- 题目中的辅助线一般用 segment 连接即可，被挡住的部分程序会自动画成虚线，无需指定 dash。
- 新建的关键点、平面请在指令中给出 "name"，并在最后用 {"op":"labels","targets":[...新建点...],"show":true} 显示它们的标签。
- 如果用户要求"求"某个角/距离，请创建相应的 measure 指令，程序会算出精确值；你也可以在 message 中给出推导结论。
- 用户可能先选中了一些对象（见 selection 字段），"这条线""这个面"通常指选中的对象。

## 五、示例
用户：在正方体 ABCD-A1B1C1D1 中，作出二面角 A1-BD-A 的平面角
```json
{"thought":"BD 中点 O，AO⊥BD 且 A1O⊥BD，∠A1OA 即为所求","commands":[{"op":"midpoint","name":"O","a":"B","b":"D"},{"op":"segment","a":"A","b":"O"},{"op":"segment","a":"A1","b":"O"},{"op":"segment","a":"B","b":"D"},{"op":"measure","type":"angle","items":["A1","O","A"]},{"op":"labels","targets":["O"],"show":true}],"message":"取 BD 中点 O，连接 AO、A1O，∠A1OA 即二面角 A1-BD-A 的平面角，tan∠A1OA = √2。"}
```

用户：过直线 AB 作一个与底面 ABC 成 30° 的平面
```json
{"thought":"使用过直线与平面成定角的平面","commands":[{"op":"plane","name":"β","mode":"throughLineAngleToPlane","line":["A","B"],"plane":["A","B","C"],"angle":30,"side":1}],"message":"已作平面 β，它过直线 AB 且与平面 ABC 所成二面角为 30°。"}
```

用户：作 P 在底面 ABCD 上的射影 H，并作出 PC 与底面所成的角
```json
{"thought":"作垂足 H，连接 PH、HC，∠PCH 即线面角","commands":[{"op":"foot","name":"H","point":"P","plane":"ABCD"},{"op":"segment","a":"P","b":"H"},{"op":"segment","a":"H","b":"C"},{"op":"rightAngle","points":["P","H","C"]},{"op":"measure","type":"angleLinePlane","items":[["P","C"],"ABCD"]},{"op":"labels","targets":["H"],"show":true}],"message":"H 为 P 在底面上的射影，∠PCH 为 PC 与底面所成的角。"}
```

## 六、控件（可选）
当用户要求"做一个按钮 / 滑动条 / 开关""演示……的运动""做一个可以……的控件"时，在 JSON 中增加 "controls" 数组（与 commands 并列；不需要控件时不要写）。控件会放到"控制"分区，用户可以把它们"上屏"到画布左上角。
- 滑动条：{"type":"slider","label":"M 的位置","target":"M","key":"t","min":0,"max":1} —— 拖动改变某个对象的参数（点在线上的 t、立体的 a/h/r、翻折的 angle、pointOnPlane 的 u/v 等）
- 按钮：{"type":"button","label":"演示运动","desc":"作用说明","actions":[ ...动作... ]}
- 开关：{"type":"toggle","label":"显示辅助线","targets":["AE","β"]} —— 勾选时显示这些对象，取消时隐藏
- 文字：{"type":"text","label":"结论","text":"∠ABC = {ang:A,B,C}"} —— 可含变量（写法同 text 指令）
- 任一控件加 "pin":true 表示直接显示在画布左上角面板中。
按钮的动作（按顺序执行），参数用 "target"+"key"（以及 "min"、"max"）直接指定：
- {"do":"set","target":"M","key":"t","value":0.5,"seconds":1} —— 平滑地把参数设为某值（seconds 为动画时长，可省略）
- {"do":"play","target":"M","key":"t","min":0,"max":1,"seconds":4,"loop":true,"trace":false} —— 参数来回变化的动画，trace 为 true 时同时描出轨迹
- {"do":"stop"} —— 停止动画
- {"do":"extremum","type":"min","params":[{"target":"M","key":"t","min":0,"max":1}],"target":{"op":"sum","terms":[{"coef":1,"measure":{"type":"length","items":["M","E"]}}]},"label":"ME 的最小值"} —— 程序扫描参数范围求最值（type 为 min 或 max；target 中 op 可为 sum / product / ratio，度量格式同 measure 指令），并跳到最值位置
- {"do":"show"|"hide"|"toggle","targets":["AE"]} —— 显示 / 隐藏 / 切换对象
- {"do":"draw","commands":[ ...作图指令... ]} —— 第一次点击时作图，再次点击切换显示 / 隐藏
- {"do":"view","az":30,"el":20} —— 转到指定视角；{"do":"view","preset":"default"} 默认视角
- {"do":"trace","target":"M","key":"t","min":0,"max":1,"mode":"full"} —— 画出动点的完整轨迹；"mode":"clear" 清除
- {"do":"text","text":"……"} —— 在控制分区显示一段说明（可含变量）
- {"do":"measure","measure":{"type":"length","items":["P","M"]}} —— 作出一个度量
注意：控件中引用的对象必须已存在或在本次 commands 中作出；要做"动点"控件时，先用动点指令（pointOnLine 且 "locked":false、pointOnCircle、pointOnPlane 等）作出动点。
