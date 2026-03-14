#!/bin/bash

# --- 配置区 ---
REMOTE_USER="ubuntu"
REMOTE_HOST="118.25.186.95"
KEY_FILE="/Users/a1-6/.ssh/tencent_key"
PROJECT_TAR="project.tar.gz"
DEPLOY_PATH="/home/ubuntu/anchor-analyzer"
IMAGE_NAME="zhuboceshi0306"
CONTAINER_NAME="zhuboceshi"
PORT_HOST="8081"
PORT_CONTAINER="3001"
DATA_VOLUME="anchor-analyzer_zhuboceshi_data"

echo "🚀 [1/5] Step 1: Frontend Build (前端构建)..."
npm run build

echo "📦 [2/5] Step 2: Project Packaging (项目打包)..."
tar -czf $PROJECT_TAR dist server.js package.json package-lock.json Dockerfile

echo "📤 [3/5] Step 3: Secure Transfer (文件上传)..."
ssh -i $KEY_FILE -o StrictHostKeyChecking=no $REMOTE_USER@$REMOTE_HOST "mkdir -p $DEPLOY_PATH"
scp -i $KEY_FILE -o StrictHostKeyChecking=no $PROJECT_TAR $REMOTE_USER@$REMOTE_HOST:$DEPLOY_PATH/

echo "💾 [3.5/5] Step 3.5: Backup remote data (数据备份)..."
ssh -i $KEY_FILE -o StrictHostKeyChecking=no $REMOTE_USER@$REMOTE_HOST \
  "sudo docker run --rm -v $DATA_VOLUME:/data alpine cp /data/db.json /data/db_backup_\$(date +%Y%m%d_%H%M%S).json 2>/dev/null && echo '✅ 数据已备份' || echo '⚠️  备份跳过（可能首次部署）'"

echo "🏗️ [4/5] Step 4: Build Image & Stop Old Container (构建镜像+停止旧容器)..."
ssh -i $KEY_FILE -o StrictHostKeyChecking=no $REMOTE_USER@$REMOTE_HOST \
  "cd $DEPLOY_PATH && tar -xzf $PROJECT_TAR && sudo docker stop $CONTAINER_NAME 2>/dev/null || true && sudo docker rm $CONTAINER_NAME 2>/dev/null || true && sudo docker build -t $IMAGE_NAME:latest ."

echo "♻️ [5/5] Step 5: Docker Launch (服务启动)..."
ssh -i $KEY_FILE -o StrictHostKeyChecking=no $REMOTE_USER@$REMOTE_HOST \
  "sudo docker run -d --name $CONTAINER_NAME -p $PORT_HOST:$PORT_CONTAINER -v $DATA_VOLUME:/app/data --restart unless-stopped $IMAGE_NAME:latest"

echo ""
echo "✅ 部署成功！历史数据已保留。"
echo "📍 访问地址: http://$REMOTE_HOST:$PORT_HOST"

# 验证
sleep 3
ssh -i $KEY_FILE -o StrictHostKeyChecking=no $REMOTE_USER@$REMOTE_HOST \
  "curl -s -o /dev/null -w 'HTTP %{http_code}' http://localhost:$PORT_HOST/"
