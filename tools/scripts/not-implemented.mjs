// Placeholder cho script chưa được hiện thực; thoát mã 1 để không bị hiểu nhầm là đã chạy.
const [, , script = 'script', task = 'task sau'] = process.argv;
console.error(`[${script}] chưa được hiện thực — sẽ có ở ${task}.`);
process.exit(1);
