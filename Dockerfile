FROM node:20-alpine
WORKDIR /app

# 1. 拷贝 package.json 并安装生产环境依赖
COPY package*.json ./
RUN npm install --production

# 2. 直接拷贝本地已经构建好的静态文件
COPY dist ./dist

# 3. 拷贝后端服务文件
COPY server.js ./

# 4. 如果有 .env 文件也拷贝进去
COPY .env ./

EXPOSE 3000
CMD ["node", "server.js"]
