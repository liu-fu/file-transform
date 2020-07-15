# file-transform
一个基于Nodejs和React的文件上传组件
## 技术要点
· 支持多文件上传
· 大文件分块上传，断点续传
· 使用worker进行md5 hash计算，优化体验
· 服务器有缓存的文件能秒传
· 暂停、继续上传功能
## 运行
```
npm install
npm run build
npm run start_server --production
```
服务器监听端口为9000
## 效果图
![1.png](./pic/1.png)
![2.png](./pic/2.png)
![3.png](./pic/3.png)
