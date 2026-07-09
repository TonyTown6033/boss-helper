import type { FormData, FormInfoData } from '@/types/formData'

const defaultAiGreetingPrompt = `你是求职者本人，正在 Boss 直聘上向招聘者发送第一句招呼语。

## 目标
写一段自然、简短、有针对性的中文开场白，提高对方愿意继续沟通的概率。

## 输出要求
- 只输出招呼语正文，不要标题、解释、JSON、Markdown 或书信格式。
- 1 到 2 句，总长度控制在 80 字以内。
- 语气礼貌、真诚、像真人聊天，不要油腻、夸张或过度套近乎。
- 结合岗位名称、技术要求或岗位描述中的 1 个具体点，避免泛泛而谈。
- 不要编造经历，不要承诺一定胜任，不要主动谈薪资、到岗时间或求内推。
- 如果岗位信息不足，就输出一条稳妥的通用技术求职开场白。

## 岗位信息
岗位名: {{ card.jobName }}
薪资: {{ card.salaryDesc }}
学历要求: {{ card.degreeName }}
经验要求: {{ card.experienceName }}
技能要求: {{ data.skills }}
岗位标签: {{ card.jobLabels }}
HR: {{ card.bossName }} {{ card.bossTitle }}
岗位描述:
{{ card.postDescription }}`

const defaultAiFilteringPrompt = `你是求职岗位筛选助手，需要根据岗位信息判断这个岗位是否值得继续投递。

## 判断原则
- 适合投递: 技术岗位职责清晰、技术栈明确、成长空间好、远程/居家办公、双休或作息稳定、福利信息正常、岗位描述具体。
- 不找外包: 明确外包、驻场、外派、派遣、OD、人力外包、第三方交付、客户现场长期开发、项目制交付到客户处等岗位不值得继续投递。
- 不考虑实习: 明确实习、校招、应届生、管培生、毕业生项目、可转正实习、在校生岗位、无经验培养岗等不值得继续投递。
- 谨慎投递: 描述空泛、长期加班暗示、销售/地推/客服导向、低薪高要求、频繁出差、强沟通或强商务属性、培训贷/收费/创业画饼、标远程但要求长期驻场或频繁到岗。
- 只根据岗位信息判断，不要臆测公司情况；没有证据的风险不要扣分。
- 如果岗位整体正常且没有明显风险，至少给一个“岗位基本匹配”的加分项 10 分。

## 打分规则
- 每个明确优点加 5 到 15 分，特别匹配可加 20 分。
- 明确支持远程办公、居家办公、不限工作地点、异地办公或混合办公且到岗要求低时，加 15 到 25 分。
- 如果只是写“可远程”但同时要求驻场、频繁出差、长期客户现场或固定高频到岗，不加远程分，并按风险扣 10 到 20 分。
- 出现明确外包/驻场/外派/派遣/OD/人力外包/客户现场长期开发/第三方交付证据时，negative 必须扣 30 到 50 分；严重或多项同时命中时扣 60 分。
- 出现明确实习/校招/应届生/管培生/毕业生项目/可转正实习/在校生岗位/无经验培养岗证据时，negative 必须扣 30 到 50 分；岗位名直接写实习或校招时扣 60 分。
- 如果公司名像外包服务商但岗位信息没有明确证据，不要仅凭公司名扣外包分；可以用“外包风险需确认”扣 5 到 10 分。
- 每个明确风险扣 5 到 20 分，严重风险可扣 30 分。
- reason 必须短而具体，说明来自哪条岗位信息。
- reason 命中外包风险时必须写明证据词，例如“岗位描述写长期客户现场驻场”或“标签含外派/派遣/OD”。
- reason 命中实习风险时必须写明证据词，例如“岗位名含实习”或“岗位标签写校招/应届生”。
- score 必须是正整数，不要写正负号。

## 输出要求
只输出 JSON，不要 Markdown、解释或额外文字。格式必须是:
{
  "negative": [
    { "reason": "扣分原因", "score": 10 }
  ],
  "positive": [
    { "reason": "加分原因", "score": 10 }
  ]
}

## 岗位信息
岗位名: {{ card.jobName }}
薪资: {{ card.salaryDesc }}
学历要求: {{ card.degreeName }}
经验要求: {{ card.experienceName }}
福利列表: {{ data.welfareList }}
技能要求: {{ data.skills }}
岗位标签: {{ card.jobLabels }}
工作地址: {{ card.address }}
通勤信息: 直线 {{ amap.straightDistance }}km，驾车 {{ amap.drivingDistance }}km/{{ amap.drivingDuration }}分钟，步行 {{ amap.walkingDistance }}km/{{ amap.walkingDuration }}分钟
岗位描述:
{{ card.postDescription }}`

export const legacyAiReplyPrompt = `你是求职者本人，正在 Boss 直聘上和招聘者聊天。

## 目标
根据当前聊天上下文，回复对方最后一条消息，推动沟通继续进行。

## 输出要求
- 只输出要发送给招聘者的回复正文，不要标题、解释、JSON、Markdown 或书信格式。
- 1 到 2 句，总长度控制在 120 字以内。
- 语气礼貌、自然、像真人聊天，不要夸张、不要油腻、不要连续追问多个问题。
- 不要编造经历、学历、项目、薪资、到岗时间或已投递状态。
- 如果对方询问你不了解的信息，诚实说明可以进一步确认，不要硬编。
- 如果对方只是寒暄，简短回应并自然询问岗位或面试相关的一个具体问题。

## 当前会话
会话: {{ chat.title }}
当前时间: {{ chat.now }}
对方最后消息:
{{ chat.currentMessage.content }}

最近聊天记录:
{{ chat.history }}`

export const defaultAiReplyPrompt = `你是求职者本人，正在 Boss 直聘上和招聘者聊天。

## 目标
根据当前聊天上下文、岗位信息和求职者资料摘要，回复对方最后一条消息，推动沟通继续进行。

## 输出要求
- 只输出要发送给招聘者的回复正文，不要标题、解释、JSON、Markdown 或书信格式。
- 1 到 3 句，总长度控制在 180 字以内。
- 语气礼貌、自然、像真人聊天，不要夸张、不要油腻、不要连续追问多个问题。
- 不要编造经历、学历、项目、薪资、到岗时间或已投递状态。
- 目标是获取更多岗位有效信息，不是无条件顺从；回复里至少要推进一个有价值的信息点。
- 必须先正面回答对方最后一个问题，再自然补充一个最关键的问题，除非对方已经明确要求你只做确认。
- 回答技术、版本、模块、项目、经验时，优先使用求职者资料摘要和最近聊天记录里的具体信息。
- 如果资料摘要和聊天记录里没有明确答案，要明确说明“这块简历里没有展开”或“具体版本需要我确认下”，不要只说“可以进一步沟通确认”。
- 对方要求发附件简历、微信、电话、资料时，可以简短回应，但必须顺带询问 1 个岗位关键问题，例如核心职责、技术栈侧重点、团队/项目方向、工作模式或面试流程。
- 不要用“好的”“可以的”“没问题”“收到”作为默认开头；避免空泛句式，不要只写“可以进一步沟通确认”“我也想了解一下”“麻烦您查收”等没有信息量的回复。
- 如果对方只是寒暄，简短回应并自然询问岗位或面试相关的一个具体问题。

## 当前会话
会话: {{ chat.title }}
当前时间: {{ chat.now }}
页面: {{ chat.url }}

## 当前岗位信息
{{ chat.jobText }}

## 求职者资料摘要
{{ chat.profile }}

## AI筛选标准
以下内容只作为求职偏好和岗位风险参考，不要继承其中的 JSON 输出格式。
{{ chat.filteringCriteria }}

## 对方最后消息
{{ chat.currentMessage.content }}

## 最近聊天记录
{{ chat.history }}`

export const formInfoData: FormInfoData = {
  config_level: {
    options: [
      {
        value: 'beginner',
        label: '新手',
      },
      {
        value: 'intermediate',
        label: '初学者',
      },
      {
        value: 'advanced',
        label: '中级',
      },
      {
        value: 'expert',
        label: '高级',
      },
    ],
    'data-help': '为不同人群展示不同的配置项, 减少上手难度跟配置过多而产生的恐惧',
  },
  company: {
    label: '公司名',
    'data-help': '公司名排除或包含在集合中，模糊匹配，可用于只投或不投某个公司/子公司。',
  },
  jobTitle: {
    label: '岗位名',
    'data-help': '岗位名排除或包含在集合中，模糊匹配，可用于只投或不投某个岗位名。',
  },
  jobContent: {
    label: '工作内容',
    'data-help':
      "会自动检测上文(不是,不,无需),下文(系统,工具),例子：[外包,上门,销售,驾照], 排除: '外包岗位', 不排除: '不是外包'|'销售系统'",
  },
  hrPosition: {
    label: 'Hr职位',
    'data-help':
      'Hr职位一定包含/排除在集合中，精确匹配, 不在内置中可手动输入,能实现只向经理等进行投递，毕竟人事干的不一定是人事',
  },
  jobAddress: {
    label: '工作地址',
    'data-help': '只能为包含模式, 即投递工作地址当中必须包含当前内容中的任意一项，否则排除',
  },
  salaryRange: {
    label: '薪资范围',
    'data-help': '投递工作的薪资范围, 更多选项可看高级配置',
  },
  companySizeRange: {
    label: '公司规模范围',
    'data-help':
      '投递工作的公司规模, 推荐使用boss自带选项进行筛选。严格宽松定义在薪资高级配置中有写',
  },
  customGreeting: {
    label: '自定义招呼语',
    'data-help':
      '因为boss不支持将自定义的招呼语设置为默认招呼语。开启表示发送boss默认的招呼语后还会发送自定义招呼语',
  },
  greetingVariable: {
    label: '招呼语变量',
    'data-help': '使用mitem模板引擎来对招呼语进行渲染;',
  },
  activityFilter: {
    label: '活跃度过滤',
    'data-help': '打开后会自动过滤掉最近未活跃的Boss发布的工作。以免浪费每天的100次机会。',
  },
  goldHunterFilter: {
    label: '猎头过滤',
    'data-help':
      'Boss中有一些猎头发布的工作，但是一般而言这种工作不太行，点击可以过滤猎头发布的职位',
  },
  friendStatus: {
    label: '好友过滤(已聊)',
    'data-help': '判断和hr是否建立过聊天，理论上能过滤的同hr，但是不同岗位的工作',
  },
  sameCompanyFilter: {
    label: '相同公司过滤',
    'data-help': '投递过的公司id存储到浏览器本地，避免多次向同公司投递，即使岗位不同hr不同',
  },
  sameHrFilter: {
    label: '相同Hr过滤',
    'data-help': '投递过的hr存储到浏览器本地，避免多次向同hr投递。',
  },
  notification: {
    label: '发送通知',
    'data-help': '可以在网站管理中打开通知权限,当停止时会自动发送桌面端通知提醒。',
  },
  useCache: {
    label: '启用缓存',
    'data-help':
      '开启后会缓存投递记录，避免重复投递，提高效率。但是缓存功能并不积极维护。可能会有bug，或者意外情况，如遇到可尝试清空缓存或者禁用',
  },
  deliveryLimit: {
    label: '投递数量',
    'data-help': '达到上限后会自动暂停，默认100次, 当前boss上限为150',
  },
  aiGreeting: {
    label: 'AI招呼语',
    'data-help':
      '即使前面招呼语开了也不会发送，只会发送AI生成的招呼语，让gpt来打招呼真是太棒了，毕竟开场白很重要。',
    example: [
      defaultAiGreetingPrompt,
      [
        {
          role: 'system',
          content: `你是求职者本人，负责写 Boss 直聘第一句招呼语。

只输出招呼语正文，1 到 2 句，80 字以内。语气礼貌自然，结合岗位中的一个具体点，不要编造经历，不要主动谈薪资或到岗时间。`,
        },
        {
          role: 'user',
          content: `岗位名: {{ card.jobName }}
薪资: {{ card.salaryDesc }}
学历要求: {{ card.degreeName }}
经验要求: {{ card.experienceName }}
技能要求: {{ data.skills }}
岗位标签: {{ card.jobLabels }}
HR: {{ card.bossName }} {{ card.bossTitle }}
岗位描述:
{{ card.postDescription }}`,
        },
      ],
    ],
  },
  aiFiltering: {
    label: 'AI过滤',
    'data-help': '根据工作内容让gpt分析过滤，真是太稳健了，不放过任何一个垃圾',
    example: [
      defaultAiFilteringPrompt,
      [
        {
          role: 'system',
          content: `你是求职岗位筛选助手。根据岗位信息输出严格 JSON，不要 Markdown、解释或额外文字。

判断原则:
- 加分: 技术岗位职责清晰、技术栈明确、成长空间好、远程/居家办公、双休或作息稳定、福利正常、岗位描述具体。
- 远程加权: 明确支持远程办公、居家办公、不限工作地点、异地办公或低频到岗混合办公时，加 15 到 25 分。
- 不找外包: 明确外包、驻场、外派、派遣、OD、人力外包、第三方交付、长期客户现场开发、项目制交付到客户处时，negative 必须扣 30 到 50 分；多项同时命中可扣 60 分。
- 不考虑实习: 明确实习、校招、应届生、管培生、毕业生项目、可转正实习、在校生岗位、无经验培养岗时，negative 必须扣 30 到 50 分；岗位名直接写实习或校招时扣 60 分。
- 扣分: 销售/地推/客服导向、低薪高要求、频繁出差、强商务属性、收费或培训贷、描述空泛、标远程但要求长期驻场或频繁到岗。
- 外包证据: reason 必须写明证据词，例如“岗位描述写长期客户现场驻场”或“标签含外派/派遣/OD”；只有公司名像外包但岗位没证据时，最多按“外包风险需确认”扣 5 到 10 分。
- 实习证据: reason 必须写明证据词，例如“岗位名含实习”或“岗位标签写校招/应届生”。
- 没有证据的风险不要扣分；整体正常且无明显风险时，positive 至少给“岗位基本匹配”10 分。

格式:
{
  "negative": [{ "reason": "扣分原因", "score": 10 }],
  "positive": [{ "reason": "加分原因", "score": 10 }]
}`,
        },
        {
          role: 'user',
          content: `岗位名: {{ card.jobName }}
薪资: {{ card.salaryDesc }}
学历要求: {{ card.degreeName }}
经验要求: {{ card.experienceName }}
福利列表: {{ data.welfareList }}
技能要求: {{ data.skills }}
岗位标签: {{ card.jobLabels }}
工作地址: {{ card.address }}
通勤信息: 直线 {{ amap.straightDistance }}km，驾车 {{ amap.drivingDistance }}km/{{ amap.drivingDuration }}分钟，步行 {{ amap.walkingDistance }}km/{{ amap.walkingDuration }}分钟
岗位描述:
{{ card.postDescription }}`,
        },
      ],
    ],
  },
  aiReply: {
    label: 'AI回复',
    'data-help':
      '在聊天页对当前打开会话进行自动回复。只处理对方新消息，不自动切换会话或遍历联系人。',
    example: [
      defaultAiReplyPrompt,
      [
        {
          role: 'system',
          content: `你是求职者本人，负责在 Boss 直聘聊天中回复招聘者。

只输出回复正文，1 到 2 句，120 字以内。语气礼貌自然，不要编造经历、薪资、到岗时间或面试安排。`,
        },
        {
          role: 'user',
          content: `会话: {{ chat.title }}
当前时间: {{ chat.now }}
对方最后消息:
{{ chat.currentMessage.content }}

最近聊天记录:
{{ chat.history }}`,
        },
      ],
    ],
  },
  record: {
    label: '内容记录',
    'data-help': '拿这些数据去训练个Ai岂不是美滋滋咯？',
  },
  delay: {
    deliveryStarts: {
      label: '投递开始',
      'data-help': '点击投递按钮会等待一段时间,默认值10s',
    },
    deliveryInterval: {
      label: '投递间隔',
      'data-help': '每个投递的间隔,太快易风控,默认值2s',
    },
    deliveryPageNext: {
      label: '投递翻页',
      'data-help': '投递完下一页之后等待的间隔,太快易风控,默认值60s',
    },
    messageSending: {
      label: '消息发送',
      'data-help': '暂未实现 ,在发送消息前允许等待一定的时间让用户来修改或手动发送,默认值5s',
      disable: true,
    },
  },
  amap: {
    enable: {
      label: '启用',
      'data-help': '启用高德地图, 用于获取工作地址的距离和时间进行筛选，需要配置自己的key',
    },
    key: {
      label: '高德地图key',
      'data-help': '高德地图key, 需要自己申请',
    },
    origins: {
      label: '起点经纬度',
      'data-help': '起点经纬度, 经度和纬度用","分隔, 可以输入完整地址点击按钮自动获取',
    },
    straightDistance: {
      label: '直线距离',
      'data-help': '直线距离, 为0禁用，单位: km',
    },
    drivingDistance: {
      label: '驾车距离',
      'data-help':
        '驾车距离, 为0禁用，会考虑当前时间的路况，不同时间结果不一样，策略为"速度优先", 单位: km',
    },
    drivingDuration: {
      label: '驾车时间',
      'data-help':
        '驾车时间, 为0禁用，会考虑当前时间的路况，不同时间结果不一样，策略为"速度优先", 单位: 分钟',
    },
    walkingDistance: {
      label: '步行距离',
      'data-help': '步行距离, 为0禁用，单位: km',
    },
    walkingDuration: {
      label: '步行时间',
      'data-help': '步行时间, 为0禁用，单位: 分钟',
    },
  },
}

export const defaultFormData: FormData = {
  config_level: 'beginner',
  company: {
    include: false,
    value: [],
    options: [],
    enable: false,
  },
  jobTitle: {
    include: true,
    value: [],
    options: [],
    enable: false,
  },
  jobContent: {
    include: false,
    value: [],
    options: [],
    enable: false,
  },
  hrPosition: {
    include: true,
    value: [],
    options: ['经理', '主管', '法人', '人力资源主管', 'hr', '招聘专员'],
    enable: false,
  },
  jobAddress: {
    value: [],
    options: [],
    enable: false,
  },
  salaryRange: {
    value: [8, 13, false],
    advancedValue: {
      // 默认全部关闭，避免用户未配置而投递错误岗位
      H: [0, 1, false],
      D: [0, 1, false],
      M: [0, 1, false],
    },
    enable: false,
  },
  companySizeRange: {
    value: [500, 2000, true],
    enable: false,
  },
  customGreeting: {
    value: '',
    enable: false,
  },
  deliveryLimit: {
    value: 120,
  },
  greetingVariable: {
    value: false,
  },
  activityFilter: {
    value: true,
  },
  friendStatus: {
    value: true,
  },
  sameCompanyFilter: {
    value: false,
  },
  sameHrFilter: {
    value: true,
  },
  goldHunterFilter: {
    value: false,
  },
  notification: {
    value: true,
  },
  useCache: {
    value: false,
  },
  aiGreeting: {
    enable: false,
    prompt: defaultAiGreetingPrompt,
  },
  aiFiltering: {
    enable: false,
    prompt: defaultAiFilteringPrompt,
    score: 10,
  },
  aiReply: {
    enable: false,
    prompt: defaultAiReplyPrompt,
  },
  amap: {
    key: '',
    origins: '',
    straightDistance: 0,
    drivingDistance: 0,
    drivingDuration: 0,
    walkingDistance: 0,
    walkingDuration: 0,
    enable: false,
  },
  record: {
    enable: false,
  },
  delay: {
    deliveryStarts: 3,
    deliveryInterval: 5,
    deliveryPageNext: 60,
    messageSending: 5,
  },
  version: '20240401',
}
