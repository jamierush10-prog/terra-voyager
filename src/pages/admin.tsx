import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore';

export default function AdminDashboard() {
  const [deployedMissions, setDeployedMissions] = useState<any[]>([]);
  const [incomingLogs, setIncomingLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Live stream every active traveling mission tracker
    const mCollection = collection(db, 'voyagerMissions');
    const unsubscribeMissions = onSnapshot(mCollection, (snapshot) => {
      const missions: any[] = [];
      snapshot.forEach((doc) => {
        missions.push({ id: doc.id, ...doc.data() });
      });
      // Sort newest launches to the top
      missions.sort((a, b) => new Date(b.launchDate).getTime() - new Date(a.launchDate).getTime());
      setDeployedMissions(missions);
    });

    // 2. Live stream every field checkpoint log transmitted
    const logsCollection = collection(db, 'telemetryLogs');
    const unsubscribeLogs = onSnapshot(logsCollection, (snapshot) => {
      const logs: any[] = [];
      snapshot.forEach((doc) => {
        logs.push({ id: doc.id, ...doc.data() });
      });
      // Sort newest check-ins to the top
      logs.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
      setIncomingLogs(logs);
      setLoading(false);
    });

    return () => {
      unsubscribeMissions();
      unsubscribeLogs();
    };
  }, []);

  const formatDisplayDateTime = (timestampValue: any) => {
    if (!timestampValue) return 'Processing...';
    let targetDate;
    if (typeof timestampValue.toDate === 'function') {
      targetDate = timestampValue.toDate();
    } else {
      targetDate = new Date(timestampValue);
    }
    if (isNaN(targetDate.getTime())) return 'Invalid Date';
    return targetDate.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        <header className="border-b border-slate-900 pb-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-black tracking-wider uppercase text-slate-200">HQ GLOBAL COMMAND OVERRIDE</h1>
            <p className="text-xs font-mono text-slate-500 uppercase mt-1">System Status: Active Terminal Uplink</p>
          </div>
        </header>

        {loading ? (
          <div className="text-center py-12 text-xs font-mono text-slate-600 animate-pulse">ESTABLISHING SECURE STREAMS...</div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            
            {/* COLUMN 1: TRACKING NODES */}
            <section className="space-y-4">
              <h2 className="text-xs font-bold font-mono tracking-widest text-blue-400 uppercase">📡 ACTIVE MISSION REGISTRY ({deployedMissions.length})</h2>
              <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-2">
                {deployedMissions.length === 0 ? (
                  <div className="p-4 bg-slate-900/40 border border-slate-900 rounded-xl font-mono text-xs text-slate-600 text-center uppercase">No Active Vectors Found.</div>
                ) : (
                  deployedMissions.map((mission) => (
                    <div key={mission.id} className="p-4 bg-slate-900/40 border border-slate-900 rounded-xl space-y-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="text-xs font-mono text-slate-500 uppercase block">LOGBOOK ID</span>
                          <span className="text-sm font-black text-slate-200 uppercase tracking-wide">{mission.id}</span>
                        </div>
                        <span className="px-2 py-0.5 text-[9px] font-mono font-bold uppercase rounded bg-blue-950 text-blue-400 border border-blue-900/30">TRAVELLING</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono bg-slate-950/50 p-2 rounded-lg border border-slate-900/50 text-slate-400">
                        <div><span className="text-slate-600 block text-[9px]">ORIGIN</span>{mission.originCity}</div>
                        <div><span className="text-slate-600 block text-[9px]">DESTINATION</span>{mission.destinationCity}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* COLUMN 2: TELEMETRY LOGS */}
            <section className="space-y-4">
              <h2 className="text-xs font-bold font-mono tracking-widest text-emerald-400 uppercase">📍 INCOMING TELEMETRY STREAMS ({incomingLogs.length})</h2>
              <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-2">
                {incomingLogs.length === 0 ? (
                  <div className="p-4 bg-slate-900/40 border border-slate-900 rounded-xl font-mono text-xs text-slate-600 text-center uppercase">Awaiting Field Transmissions...</div>
                ) : (
                  incomingLogs.map((log) => (
                    <div key={log.id} className="p-4 bg-slate-900/40 border border-slate-900 rounded-xl flex items-start space-x-4">
                      {log.imageUrl && (
                        <div className="w-16 h-16 rounded-lg bg-slate-950 border border-slate-900 overflow-hidden shrink-0 shadow-inner">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={log.imageUrl} alt="Telemetry Check" className="w-full h-full object-cover" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0 font-mono text-xs space-y-1">
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-emerald-400 font-bold uppercase">#{log.voyagerId}</span>
                          <span className="text-slate-500">{formatDisplayDateTime(log.timestamp)}</span>
                        </div>
                        <p className="text-slate-300 font-bold truncate">{log.reportedLocation}</p>
                        <p className="text-[10px] text-slate-500 uppercase tracking-tight truncate">Handler: {log.handlerName || 'Anonymous'}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

          </div>
        )}
      </div>
    </div>
  );
}