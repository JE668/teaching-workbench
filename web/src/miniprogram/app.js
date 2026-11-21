// 真机与线上环境必须改为已配置到小程序 request 合法域名中的 HTTPS 地址。
const API_BASE_URL = 'http://127.0.0.1:3000';

App({
  globalData: {
    apiBaseUrl: API_BASE_URL,
  },

  request({ path, method = 'GET', data }) {
    const baseUrl = String(this.globalData.apiBaseUrl || '').replace(/\/+$/, '');
    return new Promise((resolve, reject) => {
      if (!baseUrl) {
        reject(new Error('请先配置小程序 API 地址'));
        return;
      }
      wx.request({
        url: baseUrl + path,
        method,
        data,
        timeout: 10000,
        header: { 'content-type': 'application/json' },
        success(response) {
          const body = response.data || {};
          if (response.statusCode >= 200 && response.statusCode < 300 && body.success === true) {
            resolve(body);
            return;
          }
          const error = new Error(body.error || `请求失败（${response.statusCode}）`);
          error.statusCode = response.statusCode;
          reject(error);
        },
        fail() {
          reject(new Error('网络连接失败，请检查服务地址后重试'));
        },
      });
    });
  },
});
