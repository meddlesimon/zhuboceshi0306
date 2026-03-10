#!/bin/bash

# --- 配置区 ---
REMOTE_USER="ubuntu"
REMOTE_HOST="118.25.186.95"
KEY_FILE="/Users/a1-6/.ssh/tencent_key"
PROJECT_TAR="project.tar.gz"
DEPLOY_PATH="/home/ubuntu/anchor-analyzer"

echo "🚀 [1/5] Step 1: Frontend Build (前端构建)..."
npm run build

echo "📦 [2/5] Step 2: Project Packaging (项目打包)..."
tar -czf $PROJECT_TAR dist server.js package.json package-lock.json .env Dockerfile docker-compose.yml

echo "📤 [3/5] Step 3: Secure Transfer (文件上传)..."
# 先创建目录
ssh -i $KEY_FILE -o StrictHostKeyChecking=no $REMOTE_USER@$REMOTE_HOST "mkdir -p $DEPLOY_PATH"
# 使用 -i 指定密钥，-o BatchMode=yes 可以在失败时立即退出而不是卡住
scp -i $KEY_FILE -o StrictHostKeyChecking=no $PROJECT_TAR $REMOTE_USER@$REMOTE_HOST:$DEPLOY_PATH/

echo "🏗️ [4/5] Step 4: Remote Environment Cleanup (远程环境清理)..."
ssh -i $KEY_FILE -o StrictHostKeyChecking=no $REMOTE_USER@$REMOTE_HOST "cd $DEPLOY_PATH && tar -xzf $PROJECT_TAR && sudo docker-compose down || true && sudo docker ps -q --filter 'publish=8081' | xargs -r sudo docker stop"

echo "♻️ [5/5] Step 5: Docker Launch (服务启动)..."
ssh -i $KEY_FILE -o StrictHostKeyChecking=no $REMOTE_USER@$REMOTE_HOST "cd $DEPLOY_PATH && sudo docker-compose up -d --build"

echo "✅ 部署成功！"
echo "访问地址: http://$REMOTE_HOST:8081"
