import React, { useState, useEffect, useRef } from 'react';
import { Bell, WifiOff, Zap, Info, CheckCheck, Check, X } from 'lucide-react';
import { api } from '../services/api.ts';
import { useWebSocket } from '../hooks/useWebSocket.ts';
import type { Notification } from '../types/index.ts';

export const NotificationBell: React.FC = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { subscribeNotification } = useWebSocket();

  // Load initial notifications
  const fetchNotifications = async () => {
    try {
      setIsLoading(true);
      const res = await api.getNotifications(50);
      if (res.success) {
        setNotifications(res.notifications);
        setUnreadCount(res.unreadCount);
      }
    } catch (err) {
      console.error('Failed to load notifications:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  // Subscribe to real-time new_notification WebSocket events
  useEffect(() => {
    const cleanup = subscribeNotification((newNotif: Notification) => {
      setNotifications((prev) => [newNotif, ...prev]);
      setUnreadCount((count) => count + 1);
    });
    return cleanup;
  }, [subscribeNotification]);

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMarkAsRead = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch (err) {
      console.error('Failed to mark notification read:', err);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await api.markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all read:', err);
    }
  };

  const getIconForType = (type: string) => {
    switch (type) {
      case 'OFFLINE':
        return <WifiOff className="w-4 h-4 text-rose-400" />;
      case 'AUTOMATION_TRIGGERED':
        return <Zap className="w-4 h-4 text-amber-400" />;
      default:
        return <Info className="w-4 h-4 text-sky-400" />;
    }
  };

  const getBgForType = (type: string, isRead: boolean) => {
    if (isRead) return 'bg-slate-900/40 border-slate-800/50 opacity-80';
    switch (type) {
      case 'OFFLINE':
        return 'bg-rose-950/20 border-rose-500/30';
      case 'AUTOMATION_TRIGGERED':
        return 'bg-amber-950/20 border-amber-500/30';
      default:
        return 'bg-sky-950/20 border-sky-500/30';
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Trigger Button */}
      <button
        id="notification-bell-btn"
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-slate-300 hover:text-white hover:bg-slate-800/80 rounded-xl transition-all cursor-pointer border border-transparent hover:border-slate-700/60"
        title="Notifikasi Real-time"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white shadow-xs animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <div
          id="notification-dropdown-panel"
          className="absolute right-0 mt-2 w-80 sm:w-96 bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 rounded-2xl shadow-2xl z-50 overflow-hidden text-left"
        >
          {/* Panel Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80 bg-slate-950/60">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-sky-400" />
              <h3 className="text-sm font-semibold text-white">Notifikasi Real-Time</h3>
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 text-[10px] font-bold bg-rose-500/20 text-rose-400 rounded-full border border-rose-500/30">
                  {unreadCount} Baru
                </span>
              )}
            </div>

            {unreadCount > 0 && (
              <button
                id="mark-all-read-btn"
                onClick={handleMarkAllAsRead}
                className="flex items-center gap-1 text-[11px] font-medium text-sky-400 hover:text-sky-300 hover:underline cursor-pointer"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Tandai Dibaca
              </button>
            )}
          </div>

          {/* Notification Items List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-800/50 p-2 space-y-1.5">
            {isLoading ? (
              <div className="py-8 text-center text-xs text-slate-400">Memuat notifikasi...</div>
            ) : notifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">
                Belum ada notifikasi
              </div>
            ) : (
              notifications.map((notif) => (
                <div
                  key={notif.id}
                  className={`p-3 rounded-xl border transition-all flex items-start justify-between gap-2 ${getBgForType(
                    notif.type,
                    notif.isRead
                  )}`}
                >
                  <div className="flex items-start gap-2.5">
                    <div className="p-1.5 rounded-lg bg-slate-900 border border-slate-700/60 mt-0.5">
                      {getIconForType(notif.type)}
                    </div>
                    <div>
                      <p className="text-xs text-slate-200 font-medium leading-relaxed">
                        {notif.message}
                      </p>
                      <span className="text-[10px] text-slate-400 mt-1 block">
                        {new Date(notif.createdAt).toLocaleString('id-ID', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>

                  {!notif.isRead && (
                    <button
                      onClick={(e) => handleMarkAsRead(notif.id, e)}
                      className="p-1 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded-md transition-colors cursor-pointer shrink-0"
                      title="Tandai telah dibaca"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
