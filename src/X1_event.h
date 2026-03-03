#ifndef __EVENT_H__
#define __EVENT_H__

#define MAX_CPU 1

typedef unsigned short ICountType;

/* rezolution 1nsec : max 3sec */
typedef unsigned long EV_TIME;

#define EV_DISABLED 0xffffffffL
#define EV_SEC  1000000000L
#define EV_MSEC 1000000L
#define EV_USEC 1000L
#define EV_NSEC 1L

extern EV_TIME icount_time[];

extern ICountType BreakICount;

/* time conversion macros */
#define TIME_IN_HZ(hz)        (EV_SEC/(hz))
#define TIME_IN_CYCLES(c,cpu) ((c)*icount_time[cpu])
#define TIME_IN_SEC(s)        (EV_SEC*(s))
#define TIME_IN_MSEC(ms)      (EV_MSEC*(ms))
#define TIME_IN_USEC(us)      (EV_USEC*(us))
#define TIME_IN_NSEC(us)      (EV_NSEC*(us))

#define TIME_NOW              (0)
#define TIME_NEVER            (0xffffffff)

#define TIME_TO_CYCLES(cpu,t) ((t)/icount_time[cpu])

/* macro of allocate event state */
#define EVENT_VALUE(name,interval,callback,callback_param) {\
	name,				\
	interval,			\
	callback,			\
	callback_param,		\
	NULL,NULL,0			\
}

typedef struct event_entry
{
	/* public area : read write */
	const char *name;				// event name (only debug use)
	EV_TIME interval;				// interval time
	void (*callback)(int);			// timer callback function
	int callback_param;				// timer callback parameter
	/* private area : Don't touch ! */
	struct event_entry *next;
	struct event_entry *prev;
	EV_TIME expire;
} EVENT;

/* setup functions */
void event_init(int maxcpu);
void event_setup_cpu(int cpunum, EV_TIME clock,ICountType *ICount);
int event_update();

/* event API's */
void event_clear(EVENT *event); //should be call this before use event
void event_set(EVENT *event,EV_TIME firsttime);
void event_remove(EVENT *event);
void event_wait_cpu(int cpunum,EV_TIME waittime);

EV_TIME event_now(int *sec);
EV_TIME event_timeleft(EVENT *event);
EV_TIME event_enabled(EVENT *event);

/* for debug */
void event_dump(char *buffer);
#endif
