# 測試記憶功能指南

## 方法一：通過 Web UI 測試（推薦）

1. **登入系統**
   - 使用 admin@example.com / admin123 登入
   - 確保你是以登入用戶身份進行對話

2. **第一輪對話 - 建立記憶**
   ```
   用戶: 你好，我叫張三，我住在台北，在 Google 工作
   AI: [回應]
   ```

   這條消息應該會：
   - 提取實體：張三（人物）、台北（地點）、Google（組織）
   - 保存到 entity_memory 表
   - 保存對話到 chat_memory 表

3. **第二輪對話 - 測試記憶召回**
   ```
   用戶: 我住在哪裡？
   AI: [應該能夠回憶起你住在台北]
   ```

4. **第三輪對話 - 測試實體記憶**
   ```
   用戶: 我在哪家公司工作？
   AI: [應該能夠回憶起 Google]
   ```

## 方法二：檢查資料庫

在對話後，檢查資料庫中的記憶數據：

```bash
# 連接到資料庫
PGPASSWORD=localmind_password psql -h localhost -U localmind -d syncai_db

# 查看聊天記憶
SELECT * FROM chat_memory WHERE "userId" = 'admin-001' ORDER BY "createdAt" DESC;

# 查看實體記憶
SELECT * FROM entity_memory WHERE "userId" = 'admin-001' ORDER BY "lastMentioned" DESC;

# 退出
\q
```

## 方法三：查看控制台日志

在進行對話時，觀察服務器控制台輸出，應該會看到：

```
[Memory] Retrieved context for user: admin-001
[Memory] Added context to messages
[Memory] Saved conversation memory for user: admin-001
```

## 預期行為

### 第一次對話時：
- 不會有記憶上下文（因為是新用戶）
- 對話結束後會保存記憶

### 第二次及之後的對話：
- AI 會收到包含之前記憶的系統消息
- 可以回答關於之前對話的問題
- 實體會累積 mention count

## 記憶類型

系統支援四種記憶類型：

1. **short_term**: 當前會話的對話記錄
2. **long_term**: 跨會話的持久化記憶
3. **summary**: 對話摘要
4. **entity**: 實體追蹤（人物、地點、組織等）
