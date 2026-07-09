import { ElMessage } from 'element-plus'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { createReadonlyFilterHandle } from '@/composables/useApplying'
import type { Handler } from '@/composables/useApplying/type'
import { useChat } from '@/composables/useChat'
import { useCommon } from '@/composables/useCommon'
import { useStatistics } from '@/composables/useStatistics'
import { jobList, type MyJobListData } from '@/stores/jobs'
import type { logData } from '@/stores/log'
import { BoosHelperError } from '@/types/deliverError'
import type { Statistics } from '@/types/formData'
import { delay } from '@/utils'
import { logger } from '@/utils/logger'

import { usePager } from './usePager'

const MAX_PAGES = 50
const JOB_DELAY_SECONDS = 3
const PAGE_DELAY_SECONDS = 5

type CrawlerFilterStatus = 'passed' | 'filtered' | 'error'

interface CrawlerRow {
  job: MyJobListData
  filterStatus: CrawlerFilterStatus
  filterReason: string
  crawlError: string
}

interface CsvColumn {
  title: string
  value: (row: CrawlerRow) => unknown
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function jobUrl(job: MyJobListData): string {
  return `https://www.zhipin.com/job_detail/${job.encryptJobId}.html`
}

function joinList(value: unknown): string {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join('、')
  }
  return value == null ? '' : String(value)
}

function formatDateForFile(date = new Date()): string {
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function filterStatusLabel(status: CrawlerFilterStatus): string {
  switch (status) {
    case 'passed':
      return '通过'
    case 'filtered':
      return '已过滤'
    case 'error':
      return '出错'
  }
}

function activeTime(row: CrawlerRow): string {
  const card = row.job.card
  if (card?.activeTimeDesc) {
    return card.activeTimeDesc
  }
  const active = card?.brandComInfo?.activeTime
  return active ? new Date(active).toLocaleString() : ''
}

function csvEscape(value: unknown): string {
  const text = joinList(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function rowFromContext(
  job: MyJobListData,
  filterStatus: CrawlerFilterStatus,
  filterReason: string,
  crawlError = '',
): CrawlerRow {
  return {
    job,
    filterStatus,
    filterReason,
    crawlError,
  }
}

const csvColumns: CsvColumn[] = [
  { title: '职位名', value: (row) => row.job.card?.jobName ?? row.job.jobName },
  { title: '公司', value: (row) => row.job.card?.brandName ?? row.job.brandName },
  { title: '薪资', value: (row) => row.job.card?.salaryDesc ?? row.job.salaryDesc },
  { title: '城市', value: (row) => row.job.card?.cityName ?? row.job.cityName },
  { title: '区域', value: (row) => row.job.areaDistrict },
  { title: '商圈', value: (row) => row.job.businessDistrict },
  { title: '详细地址', value: (row) => row.job.card?.address ?? row.job.card?.jobInfo.address },
  {
    title: '经验',
    value: (row) => row.job.card?.experienceName ?? row.job.jobExperience,
  },
  { title: '学历', value: (row) => row.job.card?.degreeName ?? row.job.jobDegree },
  { title: '职位标签', value: (row) => row.job.card?.jobLabels ?? row.job.jobLabels },
  { title: '福利', value: (row) => row.job.welfareList },
  {
    title: '岗位描述',
    value: (row) => row.job.card?.postDescription ?? row.job.card?.jobInfo.postDescription,
  },
  { title: 'HR 名称', value: (row) => row.job.card?.bossName ?? row.job.bossName },
  { title: 'HR 职位', value: (row) => row.job.card?.bossTitle ?? row.job.bossTitle },
  { title: '活跃时间', value: activeTime },
  { title: '职位链接', value: (row) => jobUrl(row.job) },
  { title: '筛选状态', value: (row) => filterStatusLabel(row.filterStatus) },
  { title: '筛选原因', value: (row) => row.filterReason },
  { title: '采集错误', value: (row) => row.crawlError },
]

function downloadCsv(rows: CrawlerRow[]) {
  const lines = [
    csvColumns.map((column) => csvEscape(column.title)).join(','),
    ...rows.map((row) => csvColumns.map((column) => csvEscape(column.value(row))).join(',')),
  ]
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `boss-jobs-${formatDateForFile()}.csv`
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function restoreStatistics(statistics: ReturnType<typeof useStatistics>, snapshot: Statistics) {
  Object.assign(statistics.todayData, snapshot)
}

async function evaluateFilters(job: MyJobListData, handlers: Handler[]): Promise<CrawlerRow> {
  const statistics = useStatistics()
  const { chatMessages } = useChat()
  const statisticsSnapshot = { ...statistics.todayData }
  const chatLength = chatMessages.value.length
  const ctx: logData = { listData: job }

  try {
    for (const handler of handlers) {
      await handler({ data: job }, ctx)
    }
    return rowFromContext(job, 'passed', '通过')
  } catch (error) {
    if (error instanceof BoosHelperError) {
      return rowFromContext(
        job,
        error.state === 'warning' ? 'filtered' : 'error',
        `${error.name}: ${error.message}`,
      )
    }
    return rowFromContext(job, 'error', errorMessage(error))
  } finally {
    restoreStatistics(statistics, statisticsSnapshot)
    chatMessages.value.splice(chatLength)
  }
}

async function collectJob(job: MyJobListData, handlers: Handler[]): Promise<CrawlerRow> {
  try {
    if (job.card == null) {
      await job.getCard()
    }
  } catch (error) {
    const message = errorMessage(error)
    return rowFromContext(job, 'error', `详情获取失败: ${message}`, message)
  }

  return evaluateFilters(job, handlers)
}

function pageSignature(list: MyJobListData[]): string {
  return list.map((item) => item.encryptJobId).join('|')
}

export const useCrawler = defineStore('zhipin/crawler', () => {
  const crawling = ref(false)
  const stopRequested = ref(false)
  const rows = ref<CrawlerRow[]>([])
  const currentPage = ref(0)
  const statusText = ref('未开始')
  const { next } = usePager()
  const common = useCommon()

  const collectedCount = computed(() => rows.value.length)
  const failedCount = computed(
    () => rows.value.filter((row) => row.filterStatus === 'error' || row.crawlError).length,
  )

  function stop() {
    if (!crawling.value) {
      return
    }
    stopRequested.value = true
    statusText.value = '正在停止采集...'
  }

  async function startExport() {
    if (crawling.value) {
      return
    }
    if (common.deliverLock) {
      ElMessage.warning('投递进行中，无法采集')
      return
    }

    crawling.value = true
    stopRequested.value = false
    rows.value = []
    currentPage.value = 0
    statusText.value = '准备采集...'

    const seen = new Set<string>()
    let lastSignature = ''

    try {
      const handlers = (await createReadonlyFilterHandle()).before

      for (let pageIndex = 1; pageIndex <= MAX_PAGES && !stopRequested.value; pageIndex++) {
        currentPage.value = pageIndex
        const list = [...jobList._list.value]
        const signature = pageSignature(list)

        if (list.length === 0) {
          statusText.value = '职位列表为空'
          break
        }
        if (pageIndex > 1 && signature === lastSignature) {
          statusText.value = '职位列表无变化，采集结束'
          break
        }
        lastSignature = signature
        statusText.value = `正在采集第 ${pageIndex} 页`

        for (const [jobIndex, job] of list.entries()) {
          if (stopRequested.value) {
            break
          }
          if (seen.has(job.encryptJobId)) {
            continue
          }
          seen.add(job.encryptJobId)
          statusText.value = `正在采集第 ${pageIndex} 页，第 ${jobIndex + 1} 个岗位`
          rows.value.push(await collectJob(job, handlers))
          if (!stopRequested.value) {
            await delay(JOB_DELAY_SECONDS)
          }
        }

        if (stopRequested.value || pageIndex >= MAX_PAGES) {
          break
        }

        statusText.value = `第 ${pageIndex} 页完成，等待翻页...`
        next()
        await delay(PAGE_DELAY_SECONDS)
      }

      if (stopRequested.value) {
        statusText.value = `已停止，采集 ${rows.value.length} 个岗位`
      } else {
        statusText.value = `采集完成，共 ${rows.value.length} 个岗位`
      }

      if (rows.value.length > 0) {
        downloadCsv(rows.value)
        ElMessage.success(`已导出 ${rows.value.length} 个岗位`)
      } else {
        ElMessage.warning('没有可导出的岗位')
      }
    } catch (error) {
      const message = errorMessage(error)
      logger.error('职位采集失败', error)
      statusText.value = `采集失败: ${message}`
      if (rows.value.length > 0) {
        downloadCsv(rows.value)
        ElMessage.warning(`采集失败，已导出 ${rows.value.length} 个已采集岗位`)
      } else {
        ElMessage.error(statusText.value)
      }
    } finally {
      crawling.value = false
      stopRequested.value = false
    }
  }

  return {
    crawling,
    stopRequested,
    currentPage,
    statusText,
    collectedCount,
    failedCount,
    startExport,
    stop,
  }
})
