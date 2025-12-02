#!/bin/bash

echo "=== 檢查聊天記憶 ==="
PGPASSWORD=localmind_password psql -h localhost -U localmind -d syncai_db -c "
SELECT
  key,
  \"memoryType\",
  value::text,
  \"createdAt\"
FROM chat_memory
ORDER BY \"createdAt\" DESC
LIMIT 5;
"

echo ""
echo "=== 檢查實體記憶 ==="
PGPASSWORD=localmind_password psql -h localhost -U localmind -d syncai_db -c "
SELECT
  \"entityName\",
  \"entityType\",
  description,
  \"mentionCount\",
  facts::text,
  \"lastMentioned\"
FROM entity_memory
ORDER BY \"lastMentioned\" DESC;
"
