import { createRouter, createWebHashHistory } from 'vue-router'
import { useAppStore } from '../store/appState.js'

const routes = [
  {
    path: '/',
    name: 'start',
    component: () => import('../views/StartView.vue'),
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../views/SettingsView.vue'),
  },
  {
    path: '/project',
    component: () => import('../views/ProjectView.vue'),
    children: [
      { path: '', redirect: '/project/scripts' },
      { path: 'home', name: 'project-home', component: () => import('../views/project/ProjectHome.vue') },
      { path: 'scripts', name: 'project-scripts', component: () => import('../views/project/ScriptLibrary.vue') },
      { path: 'roles', name: 'project-roles', component: () => import('../views/project/RoleLibrary.vue') },
      { path: 'assets', name: 'project-assets', component: () => import('../views/project/AssetLibrary.vue') },
    ],
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

// 进入工程页前必须已有当前工程，否则回到起始页
router.beforeEach((to) => {
  if (to.path.startsWith('/project')) {
    const appStore = useAppStore()
    const project = appStore.currentProject || appStore.restoreCurrentProject()
    if (!project) return { path: '/' }
  }
  return true
})

export default router
