
import venom from 'venom-bot'
import textract from 'textract'
import xlsx from 'xlsx'
import fs from 'fs'

const messagePath = '../Test Message.rtf'
const sheetPath = '../Sample.xlsx'
const sheetIndex = 0

const now = () => new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '')
const get = <T>(o: Record<string, T>, k: string) => o[k]
function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

function checkFiles() {
  if (!fs.existsSync(messagePath)) throw Error(`[${now()}] Error: The file ${messagePath} does not exist`)
  if (!fs.existsSync(sheetPath)) throw Error(`[${now()}] Error: The file ${sheetPath} does not exist`)
}

function getNextNumber(sheet: xlsx.WorkSheet) {
  let id: string = ''
  const jsheet = xlsx.utils.sheet_to_json(sheet)
  let row: number = 0
  for (; row < jsheet.length; row++) {
    const _row = jsheet[row]
    if (!_row) continue
    let input = get(_row as Record<string, unknown>, 'Phone Numbers')
    const sent = get(_row as Record<string, unknown>, 'Sent')
    if (!input || !(typeof input === 'number' || typeof input === 'string')) continue
    if ((typeof input === 'string') && !/^(\+)?(d+)$/.test(input)) continue
    if (sent && typeof sent === 'string' && sent === 'yes') continue
    if (typeof input === 'string') input = input.replace('+', '')
    id = `${input}@c.us`
    break
  }
  return { id, row }
}

function updateCell(sheet: xlsx.WorkSheet, [row, cell]: [number, string], value: string) {
  const jsheet = xlsx.utils.sheet_to_json(sheet)
  if (jsheet[row]) jsheet[row][cell] = value
  else jsheet[row] = { cell: value }
  return xlsx.utils.json_to_sheet(jsheet)
}

function readMessage(path: string) {
  return new Promise<string>((resolve, reject) => {
    textract.fromFileWithPath(
      path,
      (error: unknown, text: unknown) => {
        if (error) reject(error)
        if (typeof text === 'string') resolve(text)
      }
    )
  })
}

async function waitReadiness(counter: number) {
  if (counter < 50) {
    await sleep(1000 * (30 + Math.round(Math.random() * 90)))
    return counter
  } else {
    await sleep(1000 * 60 * 30)
    return 0
  }
}

async function loopNumbers(
  callback: (id: string) => Promise<boolean>
) {
  try {
    let counter: number = 0
    while (true) {
      // Check if files exist
      checkFiles()
      // Read sheet
      const workbook = xlsx.readFile(sheetPath)
      const sheetNameList = workbook.SheetNames
      let sheet = workbook.Sheets[sheetNameList[sheetIndex]]
      // Get next number that has not been processed
      const { id, row } = getNextNumber(sheet)
      if (id === '') break
      // Call the callback
      const status = await callback(id)
      if (status) counter++
      // Update sheet
      sheet = updateCell(sheet, [row, 'Sent'], status ? 'yes' : 'no')
      sheet = updateCell(sheet, [row, 'Timestamp'], now())
      workbook.Sheets[sheetNameList[sheetIndex]] = sheet
      xlsx.writeFile(workbook, sheetPath)
      // Check if theres any number left
      const { id: _id } = getNextNumber(sheet)
      if (_id === '') break
      // Wait until conditions are met
      counter = await waitReadiness(counter)
    }
  } catch (error) {
    console.error(error)
  }
}

async function sendMessage(client: venom.Whatsapp, id: string) {
  try {
    await client.sendText(id, await readMessage(messagePath))
    console.log(`[${now()}] Message sent to: ${id}`)
    return true
  } catch (error) {
    console.log(`[${now()}] Error: Could not send message to: ${id}`)
    return false
  }
}

async function start(client: venom.Whatsapp) {
  // Make client close on exit
  process.on('SIGINT', () => client.close())
  // Run main loop
  await loopNumbers(
    async id => await sendMessage(client, id)
  )
  // Exit gracefully
  console.log(`[${now()}] Finished`)
  client.close()
  process.exit()
}

venom
  .create({
    session: 'simple-bot',
    disableWelcome: true,
    multidevice: true
  })
  .then((client) => start(client))
  .catch((error) => {
    console.log(error)
  })
