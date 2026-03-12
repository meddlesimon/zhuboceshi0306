FROM node:20-alpine
WORKDIR /app

# 安装 better-sqlite3 编译所需的原生工具链
RUN apk add --no-cache python3 make g++

# 1. 拷贝 package.json 并安装生产环境依赖（含 better-sqlite3）
COPY package*.json ./
RUN npm install --production

# 2. 直接拷贝本地已经构建好的静态文件
COPY dist ./dist

# 3. 拷贝后端服务文件
COPY server.js ./

# 4. 创建数据目录
RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "server.js"]
