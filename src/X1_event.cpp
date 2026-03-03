/*
	event timer , CPU scheduler
*/
#include <windows.h>
#include <stdio.h>
#include "x1_event.h"
#include "state_save.h"

extern ICountType Z80_ICount;

#define VERBOSE 0

#define INLINE static inline

typedef struct cpu_entry
{
	int index;
	struct cpu_entry *next;
	struct cpu_entry *prev;

	ICountType *icount;
	EV_TIME time;
	EV_TIME clock;
	EV_TIME icount_time;
} cpu_entry;

/* conversion constants */
EV_TIME icount_time[MAX_CPU];

/* break point of cpu operation */
ICountType BreakICount;

/* list of per-CPU event data */
static cpu_entry cpudata[MAX_CPU];
static cpu_entry *activecpu;

/* list of events */
static event_entry *event_head = NULL;

/* base time of 'now' */
static EV_TIME base_time;

static EV_TIME update_time;

/* global time count over sec */
static EV_TIME global_count;

/* dummy event */
static EVENT empty_event = EVENT_VALUE("end of events",0,NULL,0);

#if VERBOSE
static void verbose_print(char *s, ...);
#endif

#define absolutetime() 										\
	(activecpu->time + ((*activecpu->icount) * activecpu->icount_time))

#define set_break_count() {	\
	BreakICount = (event_head->expire<=activecpu->time)?0:(ICountType)((event_head->expire - activecpu->time)/activecpu->icount_time);\
}

INLINE void event_insert_list(EVENT *event)
{
	EV_TIME expire = event->expire;
	EVENT *t;

	/* loop over the event list */
	for (t = event_head; t!=&empty_event; t = t->next)
	{
		if(t->expire >= expire)
			break;
	}
	/* insert list */
	event->prev = t->prev;
	t->prev = event;
	event->next = t;
	if(!event->prev)
	{	/* inasert timer head */
		event_head = event;
		set_break_count();
	}
	else
	{
		event->prev->next = event;
	}
}

static void event_remove_list(event_entry *event)
{
	/* remove it from the list */
	if (event->prev)
		event->prev->next = event->next;
	else
	{	/* head of list */
		event_head = event->next;
		set_break_count();
	}
	event->next->prev = event->prev;
	event->prev = event->next = NULL;
}

void event_wait_cpu(int cpunum,EV_TIME waittime)
{
	cpu_entry *cpu = &cpudata[cpunum];

	cpu->time += waittime;
	if( cpu == activecpu)
	{
		base_time = activecpu->time;
		set_break_count();
	}
}

void event_init(int maxcpu)
{
	int i;

	if(maxcpu > MAX_CPU )
		maxcpu = MAX_CPU;

	/* we need to wait until the first call to event_cyclestorun before using real CPU times */
	global_count = 0;
	base_time = 0;

	/* if not first time , remove the all event */
	if(event_head)
	{
		while(event_head != &empty_event)
			event_remove_list(event_head);
	}
	/* initialize the lists */
	empty_event.prev = empty_event.next = NULL;
	empty_event.expire = TIME_IN_HZ(2);
	event_head = &empty_event;

	/* reset the CPU */
	memset(cpudata, 0, sizeof(cpudata));
	activecpu = cpudata;
	/* make cpu chain */
	for(i=0;i<maxcpu;i++)
	{
		cpudata[i].prev = &cpudata[i==0 ? maxcpu-1 : i-1];
		cpudata[i].next = &cpudata[i==maxcpu-1 ? 0 : i+1];
	}
}

/*
 *		set overclocking factor for a CPU
 */
void event_setup_cpu(int cpunum, EV_TIME clock,ICountType *ICount)
{
	cpu_entry *cpu = &cpudata[cpunum];
	cpu->clock = clock;
	cpu->icount = ICount;
	cpu->icount_time = icount_time[cpunum] = TIME_IN_HZ(clock);

	if(!activecpu)
	{
		activecpu = cpu;
		BreakICount = 0;
	}
}

void event_clear(EVENT *event)
{
	EVENT *t;

	if(event->next)
	{	/* search this event in the list */
		for (t = event_head; t!=&empty_event; t = t->next)
		if(t == event)
		{
			event_remove_list(event);
			break;
		}
	}
	event->prev = event->next = NULL;
}

void event_set(EVENT *event,EV_TIME firsttime)
{
	if(event->next)
		event_remove_list(event);

	/* fill in the record */
	event->expire   = absolutetime() + firsttime;
	event_insert_list(event);

	#if VERBOSE
		verbose_print("event set '%s' at %d,expire = %d\n", event->name,absolutetime(),event->expire);
	#endif
}

void event_remove(EVENT *event)
{
	if(event->next)
		event_remove_list(event);

	#if VERBOSE
		verbose_print("time %d:%d event remove '%s' at %d\n", event->name,absolutetime());
	#endif
}

EV_TIME event_timeleft(EVENT *event)
{
	if( (event->prev == NULL) && (event->next == NULL) )
		return EV_DISABLED;
	if( event->expire <= absolutetime())
		return 0;
	return  event->expire - absolutetime();
}

EV_TIME event_enabled(EVENT *event)
{
#if 1
	if(!event->next)
		return 0;
	return 1;
#else
	EVENT *t;

	if(!event->next)
		return 0;

	for (t = event_head; t!=&empty_event; t = t->next)
		if(t == event)
			return 1;
	}
	return 0;
#endif
}

EV_TIME event_now(int *sec)
{
	if(sec)
		*sec=global_count;
	return absolutetime();
}

int event_update(void)
{
	/* upate cpu cycles and cpu base time */
	activecpu->time += (*activecpu->icount) * activecpu->icount_time;
	*activecpu->icount = 0;

	/* schedule next cpu */
	{
		base_time = activecpu->time;
	}

	/* update base time */
	update_time = activecpu->time + activecpu->icount_time;
	while( event_head->expire < update_time)
	{
		event_entry *event = event_head;

		event_remove_list(event);
		if(event->interval != 0)
		{	/* interval */
			event->expire += event->interval;
			event_insert_list(event);
		}

		/* callback the event */
		base_time = event->expire;
		#if VERBOSE
			verbose_print("T=%.6g: %08X fired (exp time=%.6g)\n", absolutetime() + global_sec, event, event->expire + global_sec);
		#endif
		if (event->callback)
			(*event->callback)(event->callback_param);
	}

	/* adjust one sec times */
	if (activecpu->time >= EV_SEC)
	{
		event_entry *event;
		cpu_entry *c;

		#if VERBOSE
			verbose_print("Renormalizing %d\n", global_count);
		#endif

		/* renormalize all the CPU events */
		c = activecpu;
		do
		{
			c->time -= EV_SEC;
			c = c->next;
		}while(c != activecpu);
		/* renormalize all the events' times */
		for (event = event_head; event != &empty_event; event = event->next)
			event->expire -= EV_SEC;

		/* renormalize the global events */
		global_count++;
	}

	/* set base time to next active cpu */
	base_time = activecpu->time;

	set_break_count();
	return activecpu->index;
}

/*
 *		debugging
 */

void event_dump(char *buffer)
{
	EVENT *event;
	EV_TIME sec  = global_count;
	EV_TIME nsec = absolutetime();

	if(nsec >= EV_SEC)
	{
		sec++;
		nsec -= EV_SEC;
	}
	buffer += sprintf(buffer,"\n----- event global time %ld.%09ld sec -----\n",sec,nsec);

	/* event list */
	buffer += sprintf(buffer,"\n----- event list -----\n");
	buffer += sprintf(buffer,"name            :timeleft(s):interval(s):callback(param)\n");

	for (event = event_head; event != &empty_event; event = event->next)
	{
		/* name , expire */
		nsec  = event_timeleft(event);
		buffer += sprintf(buffer,"%-16s,%d.%09ld,",
			event->name,(int)(nsec/EV_SEC),(unsigned long)(nsec%EV_SEC) );
		/* interval */
		nsec  = event->interval;
		if(nsec)
		{
			buffer += sprintf(buffer,"%d.%09ld,",
				(int)(nsec/EV_SEC),(unsigned long)(nsec%EV_SEC) );
		}
		else
			buffer += sprintf(buffer," one shoot ,");
		/* callback */
		if(event->callback)
		{
			buffer += sprintf(buffer,"%08lx(%08lx)\n",
				(unsigned long)event->callback,
				(unsigned long)event->callback_param
			);
		}
		else
			buffer += sprintf(buffer,"no callback\n");
	}
}

// ---- state save/load helpers ----

int event_save_state(BYTE *buf, int maxlen) {
    int pos = 0;

    SS_WRITE_U32(buf, pos, base_time);
    SS_WRITE_U32(buf, pos, global_count);
    SS_WRITE_U32(buf, pos, cpudata[0].time);
    SS_WRITE_U32(buf, pos, cpudata[0].clock);

    return pos;
}

int event_load_state(const BYTE *buf, int len) {
    int pos = 0;

    EV_TIME saved_base_time;
    EV_TIME saved_global_count;
    EV_TIME saved_cpu_time;
    EV_TIME saved_clock;

    SS_READ_U32(buf, pos, saved_base_time);
    SS_READ_U32(buf, pos, saved_global_count);
    SS_READ_U32(buf, pos, saved_cpu_time);
    SS_READ_U32(buf, pos, saved_clock);

    // Clear existing events and zero cpudata (this NULLs icount!)
    event_init(1);

    // Reconnect the CPU: restores clock, icount pointer, and icount_time
    event_setup_cpu(0, saved_clock, &Z80_ICount);

    // Zero Z80_ICount so absolutetime() == saved_cpu_time until Z80C
    // section restores the real value.  This guards against any future
    // reordering that might call event_set() before Z80C is loaded.
    Z80_ICount = 0;

    // Restore timing state
    activecpu->time = saved_cpu_time;
    base_time = saved_base_time;
    global_count = saved_global_count;

    return 0;
}

#if VERBOSE
static void verbose_print(char *s, ...)
{
	va_list ap;

	va_start(ap, s);

	#if (VERBOSE == 1)
		if (errorlog) vfprintf(errorlog, s, ap);
	#else
		vprintf(s, ap);
		fflush(NULL);
	#endif

	va_end(ap);
}

#endif
