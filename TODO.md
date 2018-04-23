x streamPlan, downloadPlan 适应 IPlan
x 修改queue为queue 和 pool，为task增加uid，修改相应方法
x 重写并发机制
x 增加 nodespider 生命周期和状态
x 完善事件体系
x 修改和思考 pipe 接口
x 修改方法名称
x 修改内置pipe
x 内置 pipe 的基本测试
- 修改文档
- 完成 $.url 方法
- 修改error报错信息
- 单元测试
- - pipe 单元测试

# 为什么采用 method(name, data) 的模式？
- 可以更加灵活实现分布式爬取（简单redis）
- ……
但 pipe 是否可以避免这种写法？

# 去除 retry 方法。具体实现交给 plan 实现? 比如使用 p-retry

# 是否考虑

s.plan('', defaultPlan((res) => {

}))

s.plan('', {
  reties: 23,
  handle: asyncFn,
  handleError: fn,
  concurrency: 10,  // 同名任务的最大并发数
})

s.plan('', defaultPlan({
  reties: 6,
  handleError: (error) => {
    console.log(error)
  },
  handleResult: (res) => {
    console.log(res.url)
  },
  loadJq: true,
  option: {
  }
}))

s.plan('', streamPlan({
  handleError: console.log,
  reties: 4,
}))


s.plan('hello', (current) => {
  const $ = current.$
  console.log($('title').text())
})









-------------------------

- retry的默认callback
- download的默认callback
- method download 单元测试
- method add 单元测试
- downloadPlan 测试[]
- streamPlan 验收
- pipe 验收
- method connect 单元测试
- method save 单元测试

- pipe generator

- 在执行任务之前，先让url正常化，防止出现缺失协议的情况，使用 normalize-url
- concurrent control with planName
- modify document
- modify unit tests

- document in English
- share package in some nodejs's bbs
- website? www.nodespider.org
- 设计考虑：plan管理中，使用class继承的方式替代type？对不同class的plan进行任务管理，往往就能解决不同种类任务的管理问题

// BUG: 使用url.resolve补全url，可能导致 'http://www.xxx.com//www.xxx.com' 的问题。补全前，使用 is-absolute-url 包判断, 或考录使用 relative-url 代替
// mysql 插件
// redis queue
// TODO B 注册pipe和queue可能存在异步操作，此时应该封装到promise或async函数。但依然存在问题：当还没注册好，就调动了queue或者save