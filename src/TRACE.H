void debug_status(void);

#ifdef TRACE

extern	BYTE	trace_sw;

void tracelog_start(void);
void tracelog_end(void);
void pcwatch(void);
void trace_inport(WORD a);
void trace_inport_a(WORD a, BYTE b);
void trace_outport(WORD a, BYTE b);
void outstrbyte(char *str, WORD val);
void outstrbytel(char *str, long val);

#define	TRACE_START()		tracelog_start()
#define	TRACE_END()			tracelog_end()
#define	TRACE1()			pcwatch()
#define	TRACEIN(a)			trace_inport(a)
#define	TRACEIN_A(a,b)		trace_inport_a(a,b)
#define	TRACEOUT(a,b)		trace_outport(a,b)
#define	TRACE_(a,b)			outstrbyte(a,b)
#define	TRACEL(a,b)			outstrbytel(a,b)

#else

#define	TRACE_START()		;
#define	TRACE_END()			;
#define	TRACE1()			;
#define	TRACEIN(a)			;
#define	TRACEIN_A(a,b)		;
#define	TRACEOUT(a,b)		;
#define	TRACE_(a,b)			;
#define	TRACEL(a,b)			;

#endif
