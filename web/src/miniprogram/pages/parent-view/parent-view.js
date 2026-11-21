function cleanItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function displayDate(value) {
  return typeof value === 'string' ? value.slice(0, 10) : '';
}

Page({
  data: {
    token: '',
    loading: true,
    loadError: '',
    unavailable: false,
    view: null,
    keyProgress: [],
    focusAreas: [],
    actionForParent: '',
    teacherNote: '',
    hasContent: false,
    displayDate: '',
    readSubmitting: false,
    feedback: '',
    feedbackSubmitting: false,
    feedbackError: '',
  },

  onLoad(options) {
    const token = options && typeof options.token === 'string' ? options.token.trim() : '';
    if (!token) {
      this.setData({
        loading: false,
        unavailable: true,
        loadError: '链接不完整，请向老师重新获取家长查阅链接。',
      });
      return;
    }
    this.setData({ token });
    this.loadView();
  },

  onPullDownRefresh() {
    if (!this.data.token) {
      wx.stopPullDownRefresh();
      return;
    }
    this.loadView().finally(() => wx.stopPullDownRefresh());
  },

  async loadView() {
    const token = this.data.token;
    if (!token) return;
    this.setData({ loading: true, loadError: '', unavailable: false });
    try {
      const response = await getApp().request({
        path: '/api/parent-view/' + encodeURIComponent(token),
      });
      const view = response.data || {};
      const viewData = view.viewData || {};
      const keyProgress = cleanItems(viewData.key_progress);
      const focusAreas = cleanItems(viewData.focus_areas);
      const actionForParent = typeof viewData.action_for_parent === 'string'
        ? viewData.action_for_parent.trim()
        : '';
      const teacherNote = typeof viewData.teacher_note === 'string'
        ? viewData.teacher_note.trim()
        : '';
      this.setData({
        view,
        keyProgress,
        focusAreas,
        actionForParent,
        teacherNote,
        hasContent: keyProgress.length > 0 || focusAreas.length > 0 || !!actionForParent || !!teacherNote,
        displayDate: displayDate(view.createdAt),
        loading: false,
        feedback: '',
        feedbackError: '',
      });
      wx.setNavigationBarTitle({ title: `${view.studentName || '孩子'}的学习反馈` });
    } catch (error) {
      const unavailable = !!(error && error.statusCode === 404);
      this.setData({
        loading: false,
        unavailable,
        loadError: unavailable
          ? '链接不存在或已过期，请联系老师重新生成。'
          : (error && error.message) || '加载失败，请稍后重试。',
      });
    }
  },

  async markRead() {
    if (this.data.readSubmitting || !this.data.view || this.data.view.readAt) return;
    this.setData({ readSubmitting: true });
    try {
      await getApp().request({
        path: '/api/parent-view/' + encodeURIComponent(this.data.token) + '/read',
        method: 'POST',
        data: {},
      });
      this.setData({ 'view.readAt': new Date().toISOString() });
      wx.showToast({ title: '已确认阅读', icon: 'success' });
    } catch (error) {
      wx.showToast({
        title: (error && error.message) || '确认失败，请重试',
        icon: 'none',
      });
    } finally {
      this.setData({ readSubmitting: false });
    }
  },

  onFeedbackInput(event) {
    this.setData({ feedback: event.detail.value, feedbackError: '' });
  },

  async submitFeedback() {
    const feedback = this.data.feedback.trim();
    if (!feedback || this.data.feedbackSubmitting) return;
    if (feedback.length > 1000) {
      this.setData({ feedbackError: '留言不能超过 1000 字' });
      return;
    }
    this.setData({ feedbackSubmitting: true, feedbackError: '' });
    try {
      await getApp().request({
        path: '/api/parent-view/' + encodeURIComponent(this.data.token) + '/feedback',
        method: 'POST',
        data: { feedback },
      });
      this.setData({
        'view.parentFeedback': feedback,
        feedback: '',
      });
      wx.showToast({ title: '留言已提交', icon: 'success' });
    } catch (error) {
      this.setData({
        feedbackError: (error && error.message) || '提交失败，请稍后重试',
      });
    } finally {
      this.setData({ feedbackSubmitting: false });
    }
  },

  onShareAppMessage() {
    const studentName = this.data.view ? this.data.view.studentName : '';
    return {
      title: `${studentName || '孩子'}的学习反馈`,
      path: '/pages/parent-view/parent-view?token=' + encodeURIComponent(this.data.token),
    };
  },

  onShareTimeline() {
    const studentName = this.data.view ? this.data.view.studentName : '';
    return {
      title: `${studentName || '孩子'}的学习反馈`,
      query: 'token=' + encodeURIComponent(this.data.token),
    };
  },
});
