// require('dotenv').config();

const USER_ID = PropertiesService.getScriptProperties().getProperty("USER_ID");
const LINE_TOKEN = PropertiesService.getScriptProperties().getProperty("LINE_TOKEN");
const HOTPEPPER_API_KEY = PropertiesService.getScriptProperties().getProperty("HOTPEPPER_API_KEY");
const SHEET_ID = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";  //リプライメッセージ送信
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";    //プッシュメッセージ送信
const LINE_IMAGE_BASE_URL = "https://api-data.line.me/v2/bot/message/"
const HOTPEPPER_URL = "http://webservice.recruit.co.jp/hotpepper/gourmet/v1/"; //ホットペッパーのURL
const HOTPEPPER_RAMEN_CODE = "G013"; //ラーメンのコード
const VISION_BASE_URL = "https://vision.googleapis.com";
const MAX_REPLY = 3;

function test() {
  let latitude = 35.65;
  let longitude = 139.54;

  let ramenList = getRamenList(latitude, longitude);
  let ramenGenreList = allRamenClassify(ramenList);

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheets()[0];
  let i, result = ramenList.results;
  sheet.clearContents();
  for (i = 0; i < result.results_returned; i++) {
    sheet.appendRow([
      USER_ID,
      result.shop[i].name,
      ramenGenreList[i],
      result.shop[i].urls.pc,
      result.shop[i].catch,
      result.shop[i].shop_detail_memo,
      result.shop[i].genre.catch, //これが一番情報持っとる
    ]);
  }
}

function doPost(e) {
  console.log("doPost");

  let userId = process.env.USER_ID;
  let latitude = 35.65;
  let longitude = 139.54;

  //let lineJson = JSON.parse(e.postData.contents);

  // LINEメッセージから緯度経度を取得
  if (typeof e !== "undefined") {
    let lineJson = JSON.parse(e.postData.contents);
    userId = lineJson.events[0].source.userId;
    //console.log("type:" + lineJson.events[0].message.type);
    if (lineJson.events[0].message.type == "location") {
      // 送られてきたのが位置情報なら、その位置情報を使ってラーメン屋を検索する
      latitude = lineJson.events[0].message.latitude;
      longitude = lineJson.events[0].message.longitude;
      // 近くのラーメン屋データを取得
      let ramenList = getRamenList(latitude, longitude);
      // ラーメン屋をジャンル分け
      let ramenGenreList = allRamenClassify(ramenList);
      // 元々のデータにジャンルの情報も追加してスプレッドシートに書き込む
      WriteSheet(SHEET_ID, userId, ramenList, ramenGenreList);

    } else if (lineJson.events[0].message.type == "image") {
      // 送られてきたのが画像なら、それを解析して感情を取得し、それに合ったラーメン屋を検索する
      let lineImageUrl = LINE_IMAGE_BASE_URL + lineJson.events[0].message.id + "/content";
      let lineImage = UrlFetchApp.fetch(lineImageUrl,
        {
          "headers": { "Authorization": "Bearer " + LINE_TOKEN }
        });
      console.log(lineImage.getBlob().getContentType());

      let faceResponse = UrlFetchApp.fetch(FACE_BASE_URL + "detect?overload=stream&returnFaceAttributes=emotion", {
        "headers": {
          "Ocp-Apim-Subscription-Key": FACE_API_KEY,
          "Content-Type": "application/octet-stream"
        },
        "payload": lineImage.getBlob()
      }).getContentText();

      let faceJson = JSON.parse(faceResponse);

      //console.log(faceJson);
      console.log(faceJson[0].faceAttributes.emotion);
      let mainEmotion = emotionClassify(faceJson);

      const ss = SpreadsheetApp.openById(SHEET_ID);
      const sheet = ss.getSheets()[0];
      let values = sheet.getDataRange().getValues(); //シートから配列として読み込み

      let targetValues = values.filter(record => {
        const [uid, shopName, shopGenre] = record;
        return shopGenre == mainEmotion;
      });

      if (targetValues.length == 0) {
        targetValues = values.filter(record => {
          const [uid, shopName, shopGenre] = record;
          return (shopGenre == 0) || (shopGenre == 1) || (shopGenre == 2) || (shopGenre == 3);
        });
      }

      //以下ラインに返信する処理を記述
      replyMessage(lineJson, mainEmotion, targetValues);

    }
  }

  let lineImageUrl = "https://assets.finders.me/uploads/news/dammy/exit190218_01.jpg";

}

function WriteSheet(sheetId, userId, ramenList, ramenGenreList) {
  const ss = SpreadsheetApp.openById(sheetId);
  const sheet = ss.getSheets()[0];
  let i, result = ramenList.results;
  sheet.clearContents();
  for (i = 0; i < result.results_returned; i++) {
    sheet.appendRow([userId, result.shop[i].name, ramenGenreList[i], result.shop[i].urls.pc, result.shop[i].catch]);
  }
}

//ラーメン屋のデータを取得する関数
function getRamenList(latitude = 35.65, longitude = 139.54) {
  let url = HOTPEPPER_URL + "?key=" + HOTPEPPER_API_KEY + "&lat=" + latitude + "&lng=" + longitude + "&genre=" + HOTPEPPER_RAMEN_CODE + "&range=5&format=json&count=20";

  //ホットペッパーAPIを呼び出し
  let hotpepperResponse = UrlFetchApp.fetch(url);
  let hpJson = JSON.parse(hotpepperResponse);
  return hpJson;
}

//ラーメン屋のジャンルを分類する関数, ジャンルは0~3
function classifyRamen(ramenData) {
  let genreWords = [
    ["あっさり", "さっぱり", "しょうゆ", "だし"],
    ["人気", "有名", "王道", "定番", "絶品"],
    ["こってり", "豚骨", "がっつり", "濃厚", "こだわり", "ビール", "担々麺"]
  ];

  let start; //探索を始める位置
  let pos; //文字位置
  let count = [0, 0, 0];

  //ジャンル自体のループ
  for (let genreNum = 0; genreNum < genreWords.length; genreNum++) {
    //１ジャンルの語群のループ
    for (let wordNum = 0; wordNum < genreWords[genreNum].length; wordNum++) {
      start = 0;
      pos = 0;
      //文字列に特定の単語があるかのループ
      while (pos >= 0) {
        pos = ramenData.catch.indexOf(genreWords[genreNum][wordNum], start);
        //posはヒットしなかった場合-１が入るので、その時はループを抜ける
        //ヒットした場合はカウントを増やしてスタート位置をヒット位置の１文字後ろに設定してループの先頭に戻る
        if (pos >= 0) {
          count[genreNum]++;
          start = pos + 1;
        }
      }
    }
  }

  //ジャンル分け
  let max, maxCol;
  for (let i = 0; i < count.length; i++) {
    if (i == 0) {
      max = count[i];
      maxCol = i;
    }
    if (max < count[i]) {
      max = count[i];
      maxCol = i;
    }
  }
  
  //すべて０のときジャンルは３になる
  if (max == 0) {
    maxCol = 3;
  }
  return maxCol;
}

/*
ラーメン屋のデータリストを受け取り、それぞれのラーメン屋のジャンルを分類する関数
n番目の要素がn番目のラーメン屋のジャンル
*/
function allRamenClassify(ramenList) {
  let ramenGenreList = [];
  ramenList.results.shop.forEach(ramenData => {
    ramenGenreList.push(classifyRamen(ramenData));
  });
  return ramenGenreList;
}


/*
表情のデータからジャンル分け
怒り＝０、幸福＝１、悲しみ＝２、その他＝３

これCloudVisionバージョンに変更する必要あり
*/
function emotionClassify(faceJson) {
  let emotion = faceJson[0].faceAttributes.emotion;
  let emotions = [emotion.anger, emotion.happiness, emotion.sadness];
  let mainEmotion = emotions.indexOf(Math.max(...emotions));
  if (Math.max(...emotions) == 0) {
    mainEmotion = 3;
  }
  //console.log(mainEmotion);
  return mainEmotion;
}

// LINEにリプライメッセージを送信する関数
function replyMessage(lineJson, mainEmotion, targetValues) {
  const replyToken = lineJson.events[0].replyToken;

  // 感情に応じたテキストメッセージを作成
  let text = "";
  switch (mainEmotion) {
    case 0:
      text = "もしかして怒っていますか？\nそんな時にはあっさりとしたラーメンを食べて心を落ち着かせましょう。";
      break;
    case 1:
      text = "幸せな表情をしているあなたにはこちらのラーメンがおすすめです。";
      break;
    case 2:
      text = "なにかつらいことがありましたか？\nそんな時こそいろいろ忘れてがっつり系のラーメンを食べましょう！";
      break;
    case 3:
      text = "あまり感情が読み取れなかったので、とりあえずおすすめのラーメンを紹介しておきます。";
      break;
  }

  // Payloadの作成
  let replyPayload = {
    "replyToken": replyToken,
    "messages": [
      {
        "type": "text",
        "text": text
      }
    ]
  };

  // ラーメン屋情報を追加
  if(targetValues.length == 0){
    replyPayload.messages.push({
      "type": "text",
      "text": "おすすめのラーメン屋が見つかりませんでした。"
    });
  }else{
    for (let i = 0; i < Math.min(targetValues.length, MAX_REPLY); i++) {
      replyPayload.messages.push({
        "type": "text",
        "text": targetValues[i][1] + "\n" + targetValues[i][3]
      })
    }
  }

  // LINEにリプライメッセージを送信
  UrlFetchApp.fetch(LINE_REPLY_URL, {
    "headers": { "Authorization": "Bearer " + LINE_TOKEN },
    "contentType": "application/json",
    "payload": JSON.stringify(replyPayload)
  });

}