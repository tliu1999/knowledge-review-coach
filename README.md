# 知识回顾问答助手

输入一个知识点关键词，例如 `dropout`，助手会进入一来一回的问答回顾：

- 开始时先生成覆盖该知识点核心内容方面的客观题题库
- 题库默认按 10 个内容方面、每方面 10 题规划，目标为 100 道以上客观题
- 作答时按题库顺序推进，提交后立即显示本题判分和解析
- 追问答疑不会切断回顾主线，追问时也可以直接进入下一题
- 评估会给出本题依据、错误点和逐项选项解析
- 达到掌握标准后结束本轮复习

## 配置

复制环境变量示例：

```bash
cp .env.example .env
```

在 `.env` 中填入 DeepSeek API Key：

```bash
DEEPSEEK_API_KEY=sk-your-deepseek-api-key
REVIEW_ACCESS_PASSWORD=your-shared-access-password
DAILY_REQUEST_LIMIT=200
```

`REVIEW_ACCESS_PASSWORD` 是给访问者输入的简单调用密码。部署到公网时建议一定配置，否则任何打开网址的人都可以消耗你的 DeepSeek 额度。

`DAILY_REQUEST_LIMIT` 是单个 IP 每天最多调用 `/api/review` 的次数，默认 200。限制保存在服务进程内存中，服务重启后会重新计数。

## 启动

```bash
npm start
```

打开：

```text
http://localhost:5177
```

## 公开部署

这个项目需要 Node 后端调用 DeepSeek API，不能只用 GitHub Pages 部署。推荐用 Render、Railway、Fly.io 或 Zeabur 这类可以运行 Node Web Service 的平台。

Render 部署步骤：

1. 将代码推送到 GitHub。
2. 在 Render 新建 Web Service，连接这个仓库。
3. 如果 Render 识别到 `render.yaml`，按 Blueprint 创建服务即可；也可以手动填写：

```bash
Build Command: npm install
Start Command: npm start
```

4. 在 Render 的 Environment Variables 中配置：

```bash
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_MODEL=deepseek-chat
REVIEW_ACCESS_PASSWORD=给朋友使用的访问密码
DAILY_REQUEST_LIMIT=200
```

5. 部署完成后，Render 会提供一个公网地址。访问者打开地址后，在左侧输入访问密码，再开始回顾。

注意事项：

- DeepSeek Key 只放在后端环境变量里，不要写到前端代码或公开页面。
- 访问密码只是轻量保护，不等于完整账号系统。
- 如果准备给很多人用，建议后续增加登录、用户级额度、持久化统计和更严格限流。

## 设计原则

项目不读取本地知识库。所有题目生成和答案评估都通过 DeepSeek API 完成。

题型路径：

```text
判断题 → 单选题 → 多选题 → 循环加深
```

系统会先为当前知识点拆出一组具体内容方面，再按内容方面分批生成题库。用户作答时不再每题等待模型临时出题，而是从已生成题库中按顺序取题。只要客观题数量、正确率和内容方面覆盖达标，即使不做简答题，也可以完成本轮复盘。

掌握情况按已完成客观题统计，不完全依赖模型自评。默认展示和判定规则：

- 默认题库覆盖 10 个该知识点的核心内容方面
- 每个内容方面至少完成 10 道客观题
- 至少完成 100 道客观题
- 客观题整体正确率达到 85% 及以上
- 同时展示各内容方面的题量和正确率，便于识别薄弱方面

当用户结束回顾后，从“最近回顾”再次选择“重点回顾”时，系统会基于历史错题、低分项、遗漏点和薄弱内容方面重新生成重点题库。

简答题是可选的表达检查，不再是完成复盘的必要条件。

为了降低幻觉风险，后端提示词要求模型：

- 只基于公认教材级知识和用户回答进行判断
- 每次评估列出判断依据
- 对不确定或超出常识范围的内容标记 `needsVerification`
- 不编造论文、链接、精确数字或不存在的引用

注意：任何大模型都不能绝对保证零幻觉。这个项目把“列依据、标不确定、避免假引用”作为产品约束来降低风险。
