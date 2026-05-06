// 手动执行数据刷新的脚本
const { collectOnce } = require('../lib/collector');

async function main() {
  console.log('开始执行数据刷新...');
  
  try {
    const result = await collectOnce();
    console.log(`数据刷新完成: 成功 ${result.success} 个, 失败 ${result.failed} 个`);
  } catch (error) {
    console.error('数据刷新失败:', error);
  }
}

main();