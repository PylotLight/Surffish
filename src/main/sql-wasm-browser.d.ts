// The web build of sql.js has no Node branches (it reads __dirname otherwise, which the ESM main
// bundle lacks). We always hand it the wasm bytes, so it never fetches anything.
declare module 'sql.js/dist/sql-wasm-browser.js' {
  import initSqlJs from 'sql.js'
  export default initSqlJs
}
